import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import { AgentOrchestrator } from "../orchestrator/AgentOrchestrator.js";
import type { AgentGateway } from "./AgentGateway.js";

export class LocalAgentGateway implements AgentGateway {
  constructor(private readonly orchestrator: AgentOrchestrator) {}

  runTask(input: RunTaskInput): AsyncIterable<AgentEvent> {
    return this.orchestrator.run(input);
  }

  cancelTask(taskId: string): Promise<void> {
    return this.orchestrator.cancel(taskId);
  }
}
