import { describe, expect, it } from "vitest";
import type { AgentEvent, ChangeSet, RunTaskInput } from "@potato/protocol";
import { AgentLoop } from "../src/loop/AgentLoop.js";
import type { DiffService } from "../src/diff/DiffService.js";
import type { PiAdapter } from "../src/pi/PiAdapter.js";
import type { TraceEntry, TraceStore } from "../src/trace/TraceStore.js";

describe("AgentLoop", () => {
  it("emits task lifecycle, records trace, and emits diff before final event", async () => {
    const traceStore = new MemoryTraceStore();
    const loop = new AgentLoop(new StaticAdapter(), {
      traceStore,
      diffService: new StaticDiffService({ files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] })
    });
    const events: AgentEvent[] = [];

    for await (const event of loop.run(input())) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["task.started", "step.started", "diff.produced", "task.finished"]);
    expect(traceStore.entries.map((entry) => entry.kind)).toContain("task.input");
    expect(traceStore.entries.map((entry) => entry.kind)).toContain("diff");
    expect(traceStore.entries.at(-1)).toEqual(expect.objectContaining({ kind: "task.finished" }));
  });

  it("emits and records subagent status around adapter execution", async () => {
    const traceStore = new MemoryTraceStore();
    const loop = new AgentLoop(new StaticAdapter(), {
      traceStore,
      subAgent: {
        id: "code-reviewer",
        name: "Code Reviewer",
        description: "Review code",
        enabled: true
      }
    });
    const events: AgentEvent[] = [];

    for await (const event of loop.run(input())) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["task.started", "subagent.selected", "subagent.started", "step.started", "subagent.finished", "task.finished"]);
    expect(traceStore.entries.filter((entry) => entry.kind === "event").map((entry) => entry.event.type)).toContain("subagent.selected");
    expect(traceStore.entries.filter((entry) => entry.kind === "event").map((entry) => entry.event.type)).toContain("subagent.finished");
  });

  it("emits context budget and compaction events when usage crosses the threshold", async () => {
    const traceStore = new MemoryTraceStore();
    const loop = new AgentLoop(new StaticAdapter(), {
      traceStore,
      contextBudget: {
        maxTokens: 1000,
        compactAtRatio: 0.75,
        estimate: () => ({ usedTokens: 820, maxTokens: 1000, ratio: 0.82 }),
        compact: async () => ({
          summary: "Goal: test. Decisions: keep trace order. Next: continue.",
          originalTokens: 820,
          compactedTokens: 120
        })
      }
    });
    const events: AgentEvent[] = [];

    for await (const event of loop.run(input())) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["task.started", "context.budget", "context.compacted", "step.started", "task.finished"]);
    expect(events.find((event) => event.type === "context.budget")).toEqual(
      expect.objectContaining({ usedTokens: 820, maxTokens: 1000, ratio: 0.82, compactAtRatio: 0.75 })
    );
    expect(events.find((event) => event.type === "context.compacted")).toEqual(
      expect.objectContaining({ originalTokens: 820, compactedTokens: 120, summary: expect.stringContaining("Goal") })
    );
    expect(traceStore.entries.map((entry) => entry.kind)).toContain("context.budget");
    expect(traceStore.entries.map((entry) => entry.kind)).toContain("context.compacted");
  });
});

function input(): RunTaskInput {
  return {
    taskId: "task_1",
    workspacePath: "/repo",
    prompt: "test",
    mode: "run",
    approvalMode: "manual"
  };
}

class StaticAdapter implements PiAdapter {
  async *run(task: RunTaskInput): AsyncIterable<AgentEvent> {
    yield { type: "step.started", taskId: task.taskId, title: "work" };
    yield { type: "task.finished", taskId: task.taskId, summary: "done" };
  }
}

class StaticDiffService implements DiffService {
  constructor(private readonly changeSet: ChangeSet) {}

  async getChangeSet(): Promise<ChangeSet> {
    return this.changeSet;
  }
}

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
