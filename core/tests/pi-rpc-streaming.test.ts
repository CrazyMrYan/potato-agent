import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, RunTaskInput } from "@potato/protocol";
import { PiRpcAdapter, type PiRpcClientLike } from "../src/pi/PiRpcAdapter.js";

class FakeRpcClient implements PiRpcClientLike {
  private listeners: Array<(event: unknown) => void> = [];
  private resolveIdle?: () => void;
  started = false;
  promptStarted = false;
  lastAssistantText: string | null = "完成";
  stderr = "";

  async start(): Promise<void> {
    this.started = true;
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((current) => current !== listener);
    };
  }

  async prompt(): Promise<void> {
    this.promptStarted = true;
    queueMicrotask(() => {
      this.emit({ type: "agent_start" });
    });
  }

  waitForIdle(): Promise<void> {
    return new Promise((resolve) => {
      this.resolveIdle = resolve;
    });
  }

  async getLastAssistantText(): Promise<string | null> {
    return this.lastAssistantText;
  }

  getStderr(): string {
    return this.stderr;
  }

  async stop(): Promise<void> {}

  finish(): void {
    this.resolveIdle?.();
  }

  emit(event: unknown): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  hasListeners(): boolean {
    return this.listeners.length > 0;
  }
}

describe("PiRpcAdapter streaming", () => {
  it("starts Pi with manual-mode mutating tools and approval extension plus enabled skills", async () => {
    const client = new FakeRpcClient();
    const workspacePath = mkdtempSync(join(tmpdir(), "coding-agent-rpc-"));
    let clientOptions: unknown;
    const adapter = new PiRpcAdapter(
      {
        provider: "deepseek",
        model: "deepseek-chat",
        workspacePath,
        apiKeyEnvName: "DEEPSEEK_API_KEY",
        apiKey: "test-key",
        timeoutMs: 1000,
        permissionPolicy: { mode: "confirm" },
        skills: [
          { id: "debug", name: "debug", path: "/repo/.potato/skills/.builtin/debug", source: "builtin", enabled: true },
          { id: "off", name: "off", path: "/repo/.potato/skills/.builtin/off", source: "builtin", enabled: false }
        ]
      },
      {
        createClient: (options) => {
          clientOptions = options;
          return client;
        }
      }
    );

    const iterator = adapter.run({
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "解释项目",
      mode: "run",
      approvalMode: "manual"
    })[Symbol.asyncIterator]();

    await iterator.next();
    client.finish();
    await iterator.next();

    expect(clientOptions).toMatchObject({
      args: expect.arrayContaining(["--no-skills", "--skill", "/repo/.potato/skills/.builtin/debug", "--tools", "read,ls,grep,find,bash,edit,write", "--extension"])
    });
  });

  it("yields mapped Pi events before the RPC client becomes idle", async () => {
    const client = new FakeRpcClient();
    const adapter = new PiRpcAdapter(
      {
        provider: "deepseek",
        model: "deepseek-chat",
        workspacePath: "/repo",
        apiKeyEnvName: "DEEPSEEK_API_KEY",
        apiKey: "test-key",
        timeoutMs: 1000,
        permissionPolicy: { mode: "bypass" }
      },
      { createClient: () => client }
    );
    const input: RunTaskInput = {
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "解释项目",
      mode: "run",
      approvalMode: "manual"
    };

    const iterator = adapter.run(input)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "step.started", title: "启动 Pi RPC：deepseek/deepseek-chat" });

    const streamed = iterator.next();
    await waitUntil(() => client.hasListeners() && client.promptStarted);
    await Promise.resolve();

    expect((await streamed).value).toMatchObject<Partial<AgentEvent>>({ type: "step.started", title: "开始处理任务" });

    client.finish();
    expect((await iterator.next()).value).toMatchObject({ type: "task.finished", summary: "完成" });
  });

  it("maps Pi tool arguments and assistant deltas into visible events", async () => {
    const client = new FakeRpcClient();
    const adapter = new PiRpcAdapter(
      {
        provider: "deepseek",
        model: "deepseek-reasoner",
        workspacePath: "/repo",
        apiKeyEnvName: "DEEPSEEK_API_KEY",
        apiKey: "test-key",
        timeoutMs: 1000,
        permissionPolicy: { mode: "bypass" }
      },
      { createClient: () => client }
    );
    const input: RunTaskInput = {
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "解释项目",
      mode: "run",
      approvalMode: "manual"
    };

    const events: AgentEvent[] = [];
    const consume = (async () => {
      for await (const event of adapter.run(input)) {
        events.push(event);
      }
    })();

    await waitUntil(() => client.hasListeners() && client.promptStarted);
    client.emit({
      type: "message_update",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "需要先查看文件" },
          { type: "text", text: "我会只读检查。" },
          { type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/index.ts" } }
        ]
      }
    });
    client.emit({ type: "tool_execution_start", toolName: "read", toolCallId: "call_1", args: { path: "src/index.ts" } });
    client.emit({ type: "tool_execution_start", toolName: "bash", toolCallId: "call_2", args: { command: "rg --files" } });
    client.finish();
    await consume;

    expect(events).toContainEqual({
      type: "assistant.delta",
      taskId: "task_1",
      channel: "thinking",
      text: "需要先查看文件"
    });
    expect(events).toContainEqual({
      type: "assistant.delta",
      taskId: "task_1",
      channel: "text",
      text: "我会只读检查。"
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", tool: "read", summary: "读取文件：src/index.ts" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "tool.started", tool: "bash", summary: "执行命令：rg --files" }));
  });

  it("maps Potato todo tool results and provider cache usage into structured events", async () => {
    const client = new FakeRpcClient();
    const adapter = new PiRpcAdapter(
      {
        provider: "deepseek",
        model: "deepseek-reasoner",
        workspacePath: "/repo",
        apiKeyEnvName: "DEEPSEEK_API_KEY",
        apiKey: "test-key",
        timeoutMs: 1000,
        permissionPolicy: { mode: "bypass" }
      },
      { createClient: () => client }
    );
    const input: RunTaskInput = {
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "实现 todo",
      mode: "run",
      approvalMode: "manual"
    };

    const events: AgentEvent[] = [];
    const consume = (async () => {
      for await (const event of adapter.run(input)) {
        events.push(event);
      }
    })();

    await waitUntil(() => client.hasListeners() && client.promptStarted);
    client.emit({
      type: "tool_execution_end",
      toolName: "potato_todo_write",
      result: {
        content: [{ type: "text", text: "Todo list updated." }],
        details: {
          kind: "potato.todo",
          todos: [
            { content: "写失败测试", status: "completed", activeForm: "正在写失败测试" },
            { content: "实现 Pi extension", status: "in_progress", activeForm: "正在实现 Pi extension" }
          ]
        }
      }
    });
    client.emit({
      type: "usage",
      usage: {
        prompt_tokens: 1200,
        prompt_tokens_details: {
          cached_tokens: 512
        }
      }
    });
    client.finish();
    await consume;

    expect(events).toContainEqual({
      type: "todo.updated",
      taskId: "task_1",
      todos: [
        { content: "写失败测试", status: "completed", activeForm: "正在写失败测试" },
        { content: "实现 Pi extension", status: "in_progress", activeForm: "正在实现 Pi extension" }
      ]
    });
    expect(events).toContainEqual({
      type: "prompt.cache",
      taskId: "task_1",
      cachedTokens: 512,
      inputTokens: 1200
    });
  });

  it("surfaces stderr as a failed task when Pi becomes idle without assistant output", async () => {
    const client = new FakeRpcClient();
    client.lastAssistantText = null;
    client.stderr = "401 invalid api key\ncheck DEEPSEEK_API_KEY";
    const adapter = new PiRpcAdapter(
      {
        provider: "deepseek",
        model: "deepseek-reasoner",
        workspacePath: "/repo",
        apiKeyEnvName: "DEEPSEEK_API_KEY",
        apiKey: "bad-key",
        timeoutMs: 1000,
        permissionPolicy: { mode: "bypass" }
      },
      { createClient: () => client }
    );
    const input: RunTaskInput = {
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "今天长沙天气怎么样",
      mode: "run",
      approvalMode: "manual"
    };

    const events: AgentEvent[] = [];
    const consume = (async () => {
      for await (const event of adapter.run(input)) {
        events.push(event);
      }
    })();

    await waitUntil(() => client.hasListeners() && client.promptStarted);
    client.finish();
    await consume;

    expect(events).toContainEqual({
      type: "task.failed",
      taskId: "task_1",
      error: {
        code: "PI_EMPTY_RESPONSE",
        message: "401 invalid api key",
        cause: "401 invalid api key\ncheck DEEPSEEK_API_KEY"
      }
    });
    expect(events).not.toContainEqual(expect.objectContaining({ type: "task.finished", summary: "Pi 运行完成，但没有返回最终文本。" }));
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("等待条件超时");
}
