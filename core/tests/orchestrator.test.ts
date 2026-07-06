import { describe, expect, it } from "vitest";
import type { AgentEvent, ChangeSet, RunTaskInput } from "@potato/protocol";
import type { DiffService } from "../src/diff/DiffService.js";
import { AgentOrchestrator } from "../src/orchestrator/AgentOrchestrator.js";
import { FakePiAdapter } from "../src/pi/FakePiAdapter.js";
import type { TraceEntry, TraceStore } from "../src/trace/TraceStore.js";

describe("AgentOrchestrator", () => {
  it("emits task started and fake adapter events", async () => {
    const orchestrator = new AgentOrchestrator(new FakePiAdapter());
    const events = [];

    for await (const event of orchestrator.run(input())) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "step.started",
      "tool.started",
      "tool.finished",
      "diff.produced",
      "task.finished"
    ]);
  });

  it("writes task input, events, diff, and final state to trace", async () => {
    const traceStore = new MemoryTraceStore();
    const diffService = new StaticDiffService({ files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] });
    const orchestrator = new AgentOrchestrator(new FakePiAdapter(), { traceStore, diffService });

    for await (const _event of orchestrator.run(input())) {
      // consume stream
    }

    expect(traceStore.entries.map((entry) => entry.kind)).toContain("task.input");
    expect(traceStore.entries.filter((entry) => entry.kind === "event").length).toBeGreaterThan(0);
    expect(traceStore.entries).toContainEqual(expect.objectContaining({ kind: "diff" }));
    expect(traceStore.entries).toContainEqual(expect.objectContaining({ kind: "task.finished" }));
  });

  it("emits diff.produced after adapter completion when diff has files", async () => {
    const diffService = new StaticDiffService({ files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] });
    const orchestrator = new AgentOrchestrator(new FakePiAdapter(), { diffService });
    const events: AgentEvent[] = [];

    for await (const event of orchestrator.run(input())) {
      events.push(event);
    }

    expect(events.at(-2)).toEqual({
      type: "diff.produced",
      taskId: "task_1",
      changeSet: { files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] }
    });
    expect(events.at(-1)?.type).toBe("task.finished");
  });
});

function input(): RunTaskInput {
  return {
    taskId: "task_1",
    workspacePath: "/repo",
    prompt: "测试任务",
    mode: "run",
    approvalMode: "manual"
  };
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

class StaticDiffService implements DiffService {
  constructor(private readonly changeSet: ChangeSet) {}

  async getChangeSet(): Promise<ChangeSet> {
    return this.changeSet;
  }
}
