import { describe, expect, it, vi } from "vitest";
import { AgentSession, type PiSessionAdapter } from "@coding-agent/core";
import { chatCommand } from "../src/commands/chat.js";

class FakeSessionAdapter implements PiSessionAdapter {
  prompts: string[] = [];
  started = false;
  stopped = false;

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async *send(prompt: string): AsyncIterable<never> {
    this.prompts.push(prompt);
  }
}

describe("chat command", () => {
  it("keeps one Pi session alive for multiple terminal turns", async () => {
    const adapter = new FakeSessionAdapter();
    const read = vi.fn<() => Promise<string>>()
      .mockResolvedValueOnce("第一轮问题")
      .mockResolvedValueOnce("第二轮问题")
      .mockResolvedValueOnce("/exit");
    const write = vi.fn();

    await chatCommand({
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKey: "test-key",
      workspacePath: "/repo",
      createSession: () => new AgentSession(adapter),
      read,
      write
    });

    expect(adapter.started).toBe(true);
    expect(adapter.prompts).toEqual(["第一轮问题", "第二轮问题"]);
    expect(adapter.stopped).toBe(true);
    expect(write).toHaveBeenCalledWith(expect.stringContaining("进入交互会话"));
  });
});
