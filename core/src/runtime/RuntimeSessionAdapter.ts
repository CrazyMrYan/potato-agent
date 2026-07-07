import { streamText, type LanguageModel, type ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AgentEvent } from "@potato/protocol";
import { buildSkillContextPrompt, DEFAULT_SYSTEM_PROMPT, type AgentConfig } from "../config/AgentConfig.js";
import { McpToolRegistry, type McpToolRegistryDependencies } from "../mcp/McpToolRegistry.js";
import type { PiSessionAdapter } from "../pi/PiSessionAdapter.js";

export type RuntimeStreamText = (options: {
  model: LanguageModel;
  system: string;
  messages: RuntimeModelMessage[];
  tools?: ToolSet;
  abortSignal?: AbortSignal;
}) => Promise<{ stream: AsyncIterable<RuntimeStreamPart> }>;

type RuntimeModelMessage = {
  role: "user" | "assistant";
  content: string;
};

type RuntimeStreamPart = {
  type: string;
  text?: string;
  delta?: string;
};

export type RuntimeSessionAdapterDependencies = {
  streamText?: RuntimeStreamText;
  createModel?: (config: AgentConfig) => LanguageModel;
  mcp?: McpToolRegistryDependencies;
};

export class RuntimeSessionAdapter implements PiSessionAdapter {
  readonly name = "runtime";
  private abortController?: AbortController;
  private mcpRegistry?: McpToolRegistry;
  private readonly conversationMessages: RuntimeModelMessage[] = [];

  constructor(
    private readonly config: AgentConfig,
    private readonly dependencies: RuntimeSessionAdapterDependencies = {}
  ) {}

  async start(): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    this.abortController = undefined;
    await this.mcpRegistry?.close();
    this.mcpRegistry = undefined;
  }

  async *send(prompt: string): AsyncIterable<AgentEvent> {
    const taskId = `turn_${Date.now()}`;
    this.abortController = new AbortController();
    yield { type: "step.started", taskId, title: `Runtime adapter：${this.config.provider}/${this.config.model}` };

    try {
      const messages = [...this.conversationMessages, { role: "user" as const, content: prompt }];
      const result = await this.streamText({
        model: this.createModel(),
        system: this.systemPrompt(),
        messages,
        tools: await this.loadMcpTools(),
        abortSignal: this.abortController.signal
      });

      let summary = "";
      for await (const part of result.stream) {
        if (part.type === "reasoning-delta" && part.delta) {
          yield { type: "assistant.delta", taskId, channel: "thinking", text: part.delta };
        }
        if (part.type === "text-delta") {
          const text = part.text ?? part.delta ?? "";
          if (text) {
            summary += text;
            yield { type: "assistant.delta", taskId, channel: "text", text };
          }
        }
      }
      this.recordConversation(prompt, summary);
      yield { type: "task.finished", taskId, summary };
    } catch (error) {
      yield {
        type: "task.failed",
        taskId,
        error: {
          code: "COMMAND_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  private streamText(options: Parameters<RuntimeStreamText>[0]): Promise<{ stream: AsyncIterable<RuntimeStreamPart> }> {
    return (this.dependencies.streamText ?? defaultStreamText)(options);
  }

  private createModel(): LanguageModel {
    return this.dependencies.createModel?.(this.config) ?? createOpenAICompatibleModel(this.config);
  }

  private systemPrompt(): string {
    return [
      DEFAULT_SYSTEM_PROMPT,
      "Do not write DSML, XML, or pseudo tool call markup such as <tool_calls>. If a real tool is available, call it through the runtime tool interface. If no suitable tool is available, explain that you cannot access it yet and answer from known context.",
      buildSkillContextPrompt(this.config.skills),
      ...(this.config.appendSystemPrompt ?? [])
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private recordConversation(prompt: string, summary: string): void {
    this.conversationMessages.push({ role: "user", content: prompt });
    if (summary.trim()) {
      this.conversationMessages.push({ role: "assistant", content: summary });
    }
    const maxMessages = 20;
    if (this.conversationMessages.length > maxMessages) {
      this.conversationMessages.splice(0, this.conversationMessages.length - maxMessages);
    }
  }

  private async loadMcpTools(): Promise<ToolSet | undefined> {
    if (!this.config.mcpServers || this.config.mcpServers.length === 0) {
      return undefined;
    }
    this.mcpRegistry = new McpToolRegistry(this.config.mcpServers, this.dependencies.mcp);
    return this.mcpRegistry.loadTools();
  }
}

async function defaultStreamText(options: Parameters<RuntimeStreamText>[0]): Promise<{ stream: AsyncIterable<RuntimeStreamPart> }> {
  const result = streamText(options);
  return { stream: result.stream };
}

function createOpenAICompatibleModel(config: AgentConfig): LanguageModel {
  if (!config.model) {
    throw new Error("runtime adapter requires model.");
  }

  const provider = createOpenAICompatible({
    name: config.provider ?? "openai-compatible",
    apiKey: config.apiKey,
    baseURL: resolveBaseUrl(config.provider)
  });
  return provider.chatModel(config.model);
}

function resolveBaseUrl(provider: string | undefined): string {
  if (provider === "deepseek") {
    return "https://api.deepseek.com/v1";
  }
  return "https://api.openai.com/v1";
}
