import type { AgentEvent } from "@potato/protocol";

type PiMessageContent = {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
};

export type RawPiEvent = {
  type?: string;
  id?: string;
  method?: string;
  title?: string;
  message?: string | {
    role?: string;
    content?: PiMessageContent[];
  };
  toolName?: string;
  args?: unknown;
  result?: unknown;
  usage?: unknown;
  isError?: boolean;
};

export class PiEventMapper {
  private previousAssistantText = "";
  private previousThinkingText = "";

  constructor(private readonly taskId: string) {}

  map(event: RawPiEvent): AgentEvent[] {
    switch (event.type) {
      case "agent_start":
        return [{ type: "step.started", taskId: this.taskId, title: "开始处理任务" }];
      case "turn_start":
        return [{ type: "step.started", taskId: this.taskId, title: "思考中..." }];
      case "message_update":
        return this.mapMessageUpdate(event);
      case "tool_execution_start":
        return [
          {
            type: "tool.started",
            taskId: this.taskId,
            tool: event.toolName ?? "unknown",
            summary: summarizeToolStart(event.toolName, event.args)
          }
        ];
      case "tool_execution_end":
        return [
          {
            type: "tool.finished",
            taskId: this.taskId,
            tool: event.toolName ?? "unknown",
            success: !event.isError,
            output: summarizeToolResult(event.result)
          },
          ...this.mapTodoToolResult(event)
        ];
      case "extension_ui_request":
        return this.mapExtensionUiRequest(event);
      case "usage":
      case "usage_update":
        return this.mapUsage(event.usage ?? event);
      default:
        return [];
    }
  }

  private mapMessageUpdate(event: RawPiEvent): AgentEvent[] {
    const message = typeof event.message === "object" ? event.message : undefined;
    if (message?.role !== "assistant") {
      return [];
    }

    const content = message.content ?? [];
    const text = joinContent(content, "text");
    const thinking = joinContent(content, "thinking");
    const events: AgentEvent[] = [];

    const thinkingDelta = diffText(this.previousThinkingText, thinking);
    if (thinkingDelta) {
      events.push({ type: "assistant.delta", taskId: this.taskId, channel: "thinking", text: thinkingDelta });
    }
    this.previousThinkingText = thinking;

    const textDelta = diffText(this.previousAssistantText, text);
    if (textDelta) {
      events.push({ type: "assistant.delta", taskId: this.taskId, channel: "text", text: textDelta });
    }
    this.previousAssistantText = text;

    return events;
  }

  private mapExtensionUiRequest(event: RawPiEvent): AgentEvent[] {
    if (event.method !== "confirm" || !event.id) {
      return [];
    }

    const title = event.title ?? "Approve tool call?";
    const detail = typeof event.message === "string" ? event.message : "";
    return [
      {
        type: "approval.requested",
        taskId: this.taskId,
        request: {
          id: event.id,
          taskId: this.taskId,
          kind: inferApprovalKind(title, detail),
          title,
          detail,
          risk: inferApprovalRisk(title, detail)
        }
      }
    ];
  }

  private mapTodoToolResult(event: RawPiEvent): AgentEvent[] {
    if (event.toolName !== "potato_todo_write") {
      return [];
    }

    const todos = extractTodos(event.result);
    return todos.length > 0 ? [{ type: "todo.updated", taskId: this.taskId, todos }] : [];
  }

  private mapUsage(usage: unknown): AgentEvent[] {
    const record = toRecord(usage);
    const promptDetails = toRecord(record?.prompt_tokens_details);
    const anthropicInput = toRecord(record?.input_tokens_details);
    const cachedTokens =
      pickNumber(promptDetails, ["cached_tokens", "cachedTokens"]) ??
      pickNumber(anthropicInput, ["cache_read_input_tokens", "cacheReadInputTokens"]) ??
      pickNumber(record, ["cache_read_input_tokens", "cacheReadInputTokens", "cached_tokens", "cachedTokens"]);
    if (!cachedTokens || cachedTokens <= 0) {
      return [];
    }

    const cacheWriteTokens =
      pickNumber(anthropicInput, ["cache_creation_input_tokens", "cacheCreationInputTokens"]) ??
      pickNumber(record, ["cache_creation_input_tokens", "cacheCreationInputTokens"]);
    const inputTokens = pickNumber(record, ["prompt_tokens", "promptTokens", "input_tokens", "inputTokens"]);
    return [
      {
        type: "prompt.cache",
        taskId: this.taskId,
        cachedTokens,
        ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {})
      }
    ];
  }
}

function joinContent(content: PiMessageContent[], type: "text" | "thinking"): string {
  return content
    .filter((item) => item.type === type)
    .map((item) => (type === "text" ? item.text : item.thinking) ?? "")
    .filter((value) => value.length > 0)
    .join("\n");
}

function diffText(previous: string, current: string): string {
  if (!current || current === previous) {
    return "";
  }

  if (previous && current.startsWith(previous)) {
    return current.slice(previous.length);
  }

  return current;
}

function summarizeToolStart(toolName: string | undefined, args: unknown): string {
  const input = toRecord(args);
  const tool = toolName ?? "unknown";

  if (tool === "read") {
    return withValue("读取文件", pickString(input, ["path", "filePath", "file"]));
  }

  if (tool === "bash") {
    return withValue("执行命令", pickString(input, ["command", "cmd"]));
  }

  if (tool === "ls") {
    return withValue("列出目录", pickString(input, ["path", "dir", "directory"]));
  }

  if (tool === "grep") {
    const pattern = pickString(input, ["pattern", "query"]);
    const path = pickString(input, ["path", "include", "glob"]);
    return pattern ? `搜索：${truncate(path ? `${pattern}（${path}）` : pattern)}` : formatFallback(args);
  }

  if (tool === "find") {
    return withValue("查找", pickString(input, ["pattern", "path", "query"]));
  }

  if (tool === "edit" || tool === "write") {
    return withValue("准备修改文件", pickString(input, ["path", "filePath", "file"]));
  }

  return formatFallback(args);
}

function summarizeToolResult(result: unknown): string | undefined {
  const input = toRecord(result);
  const text = pickString(input, ["output", "text"]);
  if (text) {
    return truncate(text);
  }

  const content = input?.content;
  if (Array.isArray(content)) {
    const joined = content
      .map((item) => {
        const record = toRecord(item);
        return pickString(record, ["text"]);
      })
      .filter(Boolean)
      .join("\n");

    return joined ? truncate(joined) : undefined;
  }

  return undefined;
}

function withValue(label: string, value: string | undefined): string {
  return value ? `${label}：${truncate(value)}` : `${label}：参数未提供`;
}

function formatFallback(args: unknown): string {
  if (!args) {
    return "Pi 请求执行工具";
  }

  try {
    return `Pi 请求执行工具：${truncate(JSON.stringify(args))}`;
  } catch {
    return "Pi 请求执行工具";
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function extractTodos(result: unknown): Array<{ content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string }> {
  const record = toRecord(result);
  const details = toRecord(record?.details);
  const rawTodos = Array.isArray(details?.todos) ? details.todos : [];
  return rawTodos
    .map((item) => {
      const todo = toRecord(item);
      const content = pickString(todo, ["content"]);
      const status = pickTodoStatus(todo?.status);
      if (!content || !status) {
        return undefined;
      }
      const activeForm = pickString(todo, ["activeForm", "active_form"]);
      return {
        content,
        status,
        ...(activeForm ? { activeForm } : {})
      };
    })
    .filter((item): item is { content: string; status: "pending" | "in_progress" | "completed"; activeForm?: string } => Boolean(item));
}

function pickString(input: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!input) {
    return undefined;
  }

  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function pickNumber(input: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  if (!input) {
    return undefined;
  }

  for (const key of keys) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function pickTodoStatus(value: unknown): "pending" | "in_progress" | "completed" | undefined {
  return value === "pending" || value === "in_progress" || value === "completed" ? value : undefined;
}

function truncate(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function inferApprovalKind(title: string, detail: string): "run_command" | "write_file" | "delete_file" {
  const haystack = `${title} ${detail}`.toLowerCase();
  if (haystack.includes("delete") || haystack.includes("rm ")) {
    return "delete_file";
  }
  if (haystack.includes("bash") || haystack.includes("command")) {
    return "run_command";
  }
  return "write_file";
}

function inferApprovalRisk(title: string, detail: string): "low" | "medium" | "high" {
  const haystack = `${title} ${detail}`.toLowerCase();
  if (/\b(rm\s+-rf|sudo|chmod|chown|delete)\b/.test(haystack)) {
    return "high";
  }
  return "medium";
}
