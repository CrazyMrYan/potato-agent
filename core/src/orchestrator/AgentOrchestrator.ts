import type { AgentEvent, RunTaskInput } from "@potato/protocol";
import type { AgentLoopDependencies } from "../loop/AgentLoop.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import type { PiAdapter } from "../pi/PiAdapter.js";

export type AgentOrchestratorDependencies = AgentLoopDependencies;

export class AgentOrchestrator {
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(
    private readonly piAdapter: PiAdapter,
    private readonly dependencies: AgentOrchestratorDependencies = {}
  ) {}

  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    const abortController = new AbortController();
    this.activeRuns.set(input.taskId, abortController);
    try {
      const loop = new AgentLoop(this.piAdapter, { ...this.dependencies, abortSignal: abortController.signal });
      for await (const event of loop.run(input)) {
        yield event;
      }
    } finally {
      this.activeRuns.delete(input.taskId);
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.activeRuns.get(taskId)?.abort();
  }
}
