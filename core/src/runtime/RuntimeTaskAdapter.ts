import type { AgentEvent, RunTaskInput } from "@potato/protocol";
import type { AgentConfig } from "../config/AgentConfig.js";
import type { PiAdapter } from "../pi/PiAdapter.js";
import { RuntimeSessionAdapter, type RuntimeSessionAdapterDependencies } from "./RuntimeSessionAdapter.js";

export class RuntimeTaskAdapter implements PiAdapter {
  constructor(
    private readonly config: AgentConfig,
    private readonly dependencies: RuntimeSessionAdapterDependencies = {}
  ) {}

  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    const session = new RuntimeSessionAdapter({ ...this.config, workspacePath: input.workspacePath }, this.dependencies);
    await session.start();
    try {
      yield { type: "task.started", taskId: input.taskId, workspacePath: input.workspacePath, prompt: input.prompt };
      for await (const event of session.send(input.prompt)) {
        yield { ...event, taskId: input.taskId };
      }
    } finally {
      await session.stop();
    }
  }
}
