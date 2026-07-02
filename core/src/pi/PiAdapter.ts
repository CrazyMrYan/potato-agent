import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";

export type PiAdapterEvent = AgentEvent;

export interface PiAdapter {
  run(input: RunTaskInput): AsyncIterable<PiAdapterEvent>;
}

export type PiAdapterOptions = {
  provider: string;
  model: string;
  workspacePath: string;
  apiKeyEnvName: string;
  apiKey: string;
  timeoutMs?: number;
};
