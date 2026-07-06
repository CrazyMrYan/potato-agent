import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@potato/protocol";
import { HeuristicContextBudgetManager } from "../src/context/ContextBudget.js";
import type { PiSessionAdapter } from "../src/pi/PiSessionAdapter.js";
import { AgentSessionFactory } from "../src/session/AgentSessionFactory.js";
import type { TraceEntry, TraceStore } from "../src/trace/TraceStore.js";

class FakeSessionAdapter implements PiSessionAdapter {
  started = false;
  stopped = false;
  prompts: string[] = [];
  approvals: Array<{ requestId: string; approved: boolean }> = [];

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

  async respondToApproval(requestId: string, approved: boolean): Promise<void> {
    this.approvals.push({ requestId, approved });
  }
}

describe("AgentSessionFactory", () => {
  it("creates a reusable session through core", async () => {
    const adapter = new FakeSessionAdapter();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    const session = await factory.create({
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
    expect(events).toEqual([
      expect.objectContaining({ type: "context.budget", taskId: "turn_1" }),
      { type: "task.finished", taskId: "turn_1", summary: "完成：解释项目" }
    ]);
  });

  it("records trace entries for each session turn by default when a trace store is provided", async () => {
    const adapter = new FakeSessionAdapter();
    const traceStore = new MemoryTraceStore();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      createTraceStore: () => traceStore,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    const session = await factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    await session.start();
    for await (const _event of session.send("解释项目")) {
      // consume stream
    }
    await session.stop();

    expect(traceStore.entries.map((entry) => entry.kind)).toEqual(["task.input", "context.budget", "event", "event", "task.finished"]);
    expect(traceStore.entries[0]).toEqual(expect.objectContaining({ kind: "task.input", taskId: "turn_1" }));
  });

  it("emits context budget status for session turns", async () => {
    const adapter = new FakeSessionAdapter();
    const traceStore = new MemoryTraceStore();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      createTraceStore: () => traceStore,
      createContextBudget: () => ({
        maxTokens: 100,
        compactAtRatio: 0.75,
        estimate: () => ({ usedTokens: 80, maxTokens: 100, ratio: 0.8 }),
        compact: async () => ({ summary: "Goal: explain", originalTokens: 80, compactedTokens: 20 })
      }),
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    const session = await factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    await session.start();
    const events = [];
    for await (const event of session.send("解释项目")) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["context.budget", "context.compacted", "task.finished"]);
    expect(traceStore.entries.map((entry) => entry.kind)).toContain("context.budget");
    expect(traceStore.entries.map((entry) => entry.kind)).toContain("context.compacted");
  });

  it("accumulates context budget across session turns", async () => {
    const adapter = new FakeSessionAdapter();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      createContextBudget: () => new HeuristicContextBudgetManager(100, 0.75),
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    const session = await factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    let firstBudget = 0;
    for await (const event of session.send("first prompt")) {
      if (event.type === "context.budget") firstBudget = event.usedTokens;
    }

    let secondBudget = 0;
    for await (const event of session.send("second prompt")) {
      if (event.type === "context.budget") secondBudget = event.usedTokens;
    }

    expect(secondBudget).toBeGreaterThan(firstBudget);
  });

  it("supports manual context compaction through the active session", async () => {
    const adapter = new FakeSessionAdapter();
    const traceStore = new MemoryTraceStore();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      createTraceStore: () => traceStore,
      createContextBudget: () => ({
        maxTokens: 100,
        compactAtRatio: 0.75,
        estimate: () => ({ usedTokens: 20, maxTokens: 100, ratio: 0.2 }),
        compact: async () => ({ summary: "Manual summary", originalTokens: 20, compactedTokens: 4 })
      }),
      env: { DEEPSEEK_API_KEY: "test-key" }
    });
    const session = await factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    const events = [];
    for await (const event of session.compactContext("manual")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "context.budget", taskId: "manual_compact", usedTokens: 20, maxTokens: 100, ratio: 0.2, compactAtRatio: 0.75 },
      { type: "context.compacted", taskId: "manual_compact", summary: "Manual summary", originalTokens: 20, compactedTokens: 4 }
    ]);
    expect(traceStore.entries.map((entry) => entry.kind)).toContain("context.compacted");
  });

  it("forwards approval decisions to the active adapter", async () => {
    const adapter = new FakeSessionAdapter();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });
    const session = await factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    await session.approve("approval_1", true);
    await session.approve("approval_2", false);

    expect(adapter.approvals).toEqual([
      { requestId: "approval_1", approved: true },
      { requestId: "approval_2", approved: false }
    ]);
  });

  it("rejects approval and stops the active adapter when pausing", async () => {
    const adapter = new FakeSessionAdapter();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });
    const session = await factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    await session.rejectAndPause("approval_1");

    expect(adapter.approvals).toEqual([{ requestId: "approval_1", approved: false }]);
    expect(adapter.stopped).toBe(true);
  });

  it("creates a standard runtime session when adapter is runtime", async () => {
    const factory = new AgentSessionFactory({
      env: { OPENAI_API_KEY: "test-key" },
      createTraceStore: () => new MemoryTraceStore()
    });

    const session = await factory.create({
      adapter: "runtime",
      provider: "openai-compatible",
      model: "test-model",
      apiKey: "test-key",
      workspacePath: "/repo"
    });

    expect(session.adapterName()).toBe("runtime");
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
