import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import type { AgentLoopDependencies } from "../loop/AgentLoop.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import type { PiAdapter } from "../pi/PiAdapter.js";

export type AgentOrchestratorDependencies = AgentLoopDependencies;

export class AgentOrchestrator {
  constructor(
    private readonly piAdapter: PiAdapter,
    private readonly dependencies: AgentOrchestratorDependencies = {}
  ) {}

  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    const loop = new AgentLoop(this.piAdapter, this.dependencies);
    for await (const event of loop.run(input)) {
      yield event;
    }
  }

  async cancel(_taskId: string): Promise<void> {
    return;
  }
}
