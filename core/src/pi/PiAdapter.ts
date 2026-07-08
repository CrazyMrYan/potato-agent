import type { AgentEvent, RunTaskInput } from "@potato/protocol";
import type { AgentConfig } from "../config/AgentConfig.js";

export type PiAdapterEvent = AgentEvent;

export type PiAdapterRunOptions = {
  signal?: AbortSignal;
};

export interface PiAdapter {
  run(input: RunTaskInput, options?: PiAdapterRunOptions): AsyncIterable<PiAdapterEvent>;
}

export type PiAdapterOptions = AgentConfig & {
  provider: string;
  model: string;
  workspacePath: string;
  apiKeyEnvName: string;
  apiKey: string;
};
