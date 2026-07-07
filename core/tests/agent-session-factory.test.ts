import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@potato/protocol";
import { HeuristicContextBudgetManager } from "../src/context/ContextBudget.js";
import type { PiSessionAdapter } from "../src/pi/PiSessionAdapter.js";
import { AgentSessionFactory } from "../src/session/AgentSessionFactory.js";
import type { TraceEntry, TraceStore } from "../src/trace/TraceStore.js";
import type { VerificationRunner } from "../src/verification/VerificationRunner.js";

class FakeSessionAdapter implements PiSessionAdapter {
  started = false;
  stopped = false;
  prompts: string[] = [];
  approvals: Array<{ requestId: string; approved: boolean }> = [];
  compactCalls: Array<string | undefined> = [];

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

  async compact(customInstructions?: string): Promise<{ summary: string; originalTokens?: number; compactedTokens?: number }> {
    this.compactCalls.push(customInstructions);
    return { summary: "Pi compacted", originalTokens: 100, compactedTokens: 25 };
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

  it("uses Pi RPC as the default execution adapter", async () => {
    const factory = new AgentSessionFactory({
      env: { OPENAI_API_KEY: "test-key", DEEPSEEK_API_KEY: "test-key" },
      createTraceStore: () => new MemoryTraceStore()
    });

    const session = await factory.create({
      provider: "deepseek",
      model: "test-model",
      apiKey: "test-key",
      workspacePath: "/repo"
    });

    expect(session.adapterName()).toBe("rpc");
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
    const adapter: PiSessionAdapter = {
      async start() {},
      async stop() {},
      async *send(prompt: string) {
        yield { type: "task.finished", taskId: "turn_1", summary: prompt };
      }
    };
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

  it("uses native Pi compaction when the adapter supports it", async () => {
    const adapter = new FakeSessionAdapter();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      createContextBudget: () => ({
        maxTokens: 100,
        compactAtRatio: 0.75,
        estimate: () => ({ usedTokens: 20, maxTokens: 100, ratio: 0.2 }),
        compact: async () => ({ summary: "Fallback summary", originalTokens: 20, compactedTokens: 4 })
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

    expect(adapter.compactCalls).toEqual(["manual context compaction"]);
    expect(events).toEqual([
      { type: "context.compacted", taskId: "manual_compact", summary: "Pi compacted", originalTokens: 100, compactedTokens: 25 }
    ]);
  });

  it("treats native Pi session-too-small compaction as a skipped status instead of an error", async () => {
    const adapter = new FakeSessionAdapter();
    adapter.compact = async (customInstructions?: string) => {
      adapter.compactCalls.push(customInstructions);
      throw new Error("Nothing to compact (session too small)");
    };
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
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

    expect(adapter.compactCalls).toEqual(["manual context compaction"]);
    expect(events).toEqual([
      {
        type: "context.compacted",
        taskId: "manual_compact",
        summary: "Nothing to compact (session too small).",
        originalTokens: 0,
        compactedTokens: 0
      }
    ]);
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

  it("cancels the active session task, stops the adapter, and records TASK_CANCELLED", async () => {
    const adapter = new FakeSessionAdapter();
    const traceStore = new MemoryTraceStore();
    let releaseSend!: () => void;
    const sendBlocked = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    adapter.send = async function* (prompt: string) {
      this.prompts.push(prompt);
      yield { type: "step.started" as const, taskId: "turn_1", title: "working" };
      await sendBlocked;
      yield { type: "task.finished" as const, taskId: "turn_1", summary: "should not finish" };
    };

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

    const events: AgentEvent[] = [];
    const consume = (async () => {
      for await (const event of session.send("long task")) {
        events.push(event);
        if (event.type === "step.started") {
          await session.cancelCurrentTask();
          releaseSend();
        }
      }
    })();

    await consume;

    expect(adapter.stopped).toBe(true);
    expect(events.at(-1)).toEqual({
      type: "task.failed",
      taskId: "turn_1",
      error: { code: "TASK_CANCELLED", message: "Task cancelled by user." }
    });
    expect(traceStore.entries).toContainEqual(
      expect.objectContaining({ kind: "task.failed", code: "TASK_CANCELLED", message: "Task cancelled by user." })
    );
  });

  it("runs verification for interactive session turns before task.finished is yielded", async () => {
    const adapter = new FakeSessionAdapter();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      createVerificationRunner: () =>
        ({
          detect: async () => undefined,
          run: async () => ({ command: "pnpm test", exitCode: 0, output: "pass" })
        }) as VerificationRunner,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });
    const session = await factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo",
      verification: { enabled: true, command: "pnpm test" }
    });

    const events: AgentEvent[] = [];
    for await (const event of session.send("change code")) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "context.budget",
      "verification.started",
      "verification.finished",
      "task.finished"
    ]);
  });

  it("persists session metadata when a session turn finishes", async () => {
    const adapter = new FakeSessionAdapter();
    const saved: unknown[] = [];
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      createSessionMetadataStore: () => ({
        save: async (metadata) => {
          saved.push(metadata);
        }
      }),
      env: { DEEPSEEK_API_KEY: "test-key" }
    });
    const session = await factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    for await (const _event of session.send("explain")) {
      // consume turn
    }

    expect(saved).toEqual([
      expect.objectContaining({
        provider: "deepseek",
        model: "deepseek-reasoner",
        workspacePath: "/repo",
        traceTaskId: "turn_1",
        summary: "完成：explain"
      })
    ]);
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

  it("creates the standard runtime session for sdk adapter selection", async () => {
    const factory = new AgentSessionFactory({
      env: { OPENAI_API_KEY: "test-key" },
      createTraceStore: () => new MemoryTraceStore()
    });

    const session = await factory.create({
      adapter: "sdk",
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
