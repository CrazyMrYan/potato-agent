import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import type { AgentConfig } from "../config/AgentConfig.js";

export type PiAdapterEvent = AgentEvent;

export interface PiAdapter {
  run(input: RunTaskInput): AsyncIterable<PiAdapterEvent>;
}

export type PiAdapterOptions = AgentConfig & {
  provider: string;
  model: string;
  workspacePath: string;
  apiKeyEnvName: string;
  apiKey: string;
};
