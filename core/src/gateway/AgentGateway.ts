import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";

export interface AgentGateway {
  runTask(input: RunTaskInput): AsyncIterable<AgentEvent>;
  cancelTask(taskId: string): Promise<void>;
}
