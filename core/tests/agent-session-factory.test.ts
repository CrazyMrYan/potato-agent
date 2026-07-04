import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@coding-agent/protocol";
import type { PiSessionAdapter } from "../src/pi/PiSessionAdapter.js";
import { AgentSessionFactory } from "../src/session/AgentSessionFactory.js";
import type { TraceEntry, TraceStore } from "../src/trace/TraceStore.js";

class FakeSessionAdapter implements PiSessionAdapter {
  started = false;
  stopped = false;
  prompts: string[] = [];

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async *send(prompt: string): AsyncIterable<AgentEvent> {
    this.prompts.push(prompt);
    yield { type: "task.finished", taskId: "turn_1", summary: `完成：${prompt}` };
  }
}

describe("AgentSessionFactory", () => {
  it("creates a reusable session through core", async () => {
    const adapter = new FakeSessionAdapter();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    const session = factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    await session.start();
    const events = [];
    for await (const event of session.send("解释项目")) {
      events.push(event);
    }
    await session.stop();

    expect(adapter.started).toBe(true);
    expect(adapter.prompts).toEqual(["解释项目"]);
    expect(adapter.stopped).toBe(true);
    expect(events).toEqual([{ type: "task.finished", taskId: "turn_1", summary: "完成：解释项目" }]);
  });

  it("records trace entries for each session turn by default when a trace store is provided", async () => {
    const adapter = new FakeSessionAdapter();
    const traceStore = new MemoryTraceStore();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      createTraceStore: () => traceStore,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    const session = factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    await session.start();
    for await (const _event of session.send("解释项目")) {
      // consume stream
    }
    await session.stop();

    expect(traceStore.entries.map((entry) => entry.kind)).toEqual(["task.input", "event", "task.finished"]);
    expect(traceStore.entries[0]).toEqual(expect.objectContaining({ kind: "task.input", taskId: "turn_1" }));
  });
});

class MemoryTraceStore implements TraceStore {
  entries: TraceEntry[] = [];

  async append(entry: TraceEntry): Promise<void> {
    this.entries.push(entry);
  }

  async read(): Promise<TraceEntry[]> {
    return this.entries;
  }

  async list(): Promise<never[]> {
    return [];
  }
}
