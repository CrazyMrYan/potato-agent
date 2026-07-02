export type AgentConfig = {
  provider?: string;
  model?: string;
  apiKey?: string;
  workspacePath?: string;
  timeoutMs?: number;
};

export type ResolvedAgentConfig = Required<Pick<AgentConfig, "provider" | "model" | "apiKey" | "workspacePath">> &
  Pick<AgentConfig, "timeoutMs">;

export function mergeAgentConfig(stored: AgentConfig, runtime: AgentConfig): AgentConfig {
  return {
    ...stored,
    ...withoutUndefined(runtime)
  };
}

function withoutUndefined(config: AgentConfig): AgentConfig {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) as AgentConfig;
}
