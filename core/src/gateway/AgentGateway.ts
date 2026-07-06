import type { AgentEvent, RunTaskInput } from "@potato/protocol";

export interface AgentGateway {
  runTask(input: RunTaskInput): AsyncIterable<AgentEvent>;
  cancelTask(taskId: string): Promise<void>;
}
