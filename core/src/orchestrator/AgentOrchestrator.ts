import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import type { PiAdapter } from "../pi/PiAdapter.js";

export class AgentOrchestrator {
  constructor(private readonly piAdapter: PiAdapter) {}

  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    yield {
      type: "task.started",
      taskId: input.taskId,
      workspacePath: input.workspacePath,
      prompt: input.prompt
    };

    for await (const event of this.piAdapter.run(input)) {
      yield event;
    }
  }

  async cancel(_taskId: string): Promise<void> {
    return;
  }
}
