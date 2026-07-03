export type AgentConfig = {
  provider?: string;
  model?: string;
  apiKey?: string;
  workspacePath?: string;
  timeoutMs?: number;
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  skills?: AgentSkillConfig[];
  mcpServers?: AgentMcpServerConfig[];
  tools?: AgentToolConfig;
  permissionPolicy?: AgentPermissionPolicy;
};

export type ResolvedAgentConfig = Required<Pick<AgentConfig, "provider" | "model" | "apiKey" | "workspacePath">> &
  Pick<AgentConfig, "timeoutMs">;

export type AgentSkillConfig = {
  path: string;
};

export type AgentMcpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AgentToolConfig = {
  allow?: string[];
  deny?: string[];
  noTools?: boolean;
  noBuiltinTools?: boolean;
};

export type AgentPermissionMode = "confirm" | "bypass" | "readonly";

export type AgentPermissionPolicy = {
  mode: AgentPermissionMode;
  allow?: string[];
  confirm?: string[];
  deny?: string[];
};

export const DEFAULT_AGENT_PERMISSION_POLICY: Required<AgentPermissionPolicy> = {
  mode: "confirm",
  allow: ["read", "ls", "grep", "find"],
  confirm: ["bash", "edit", "write"],
  deny: []
};

export function mergeAgentConfig(stored: AgentConfig, runtime: AgentConfig): AgentConfig {
  const merged = {
    ...stored,
    ...withoutUndefined(runtime)
  };

  if (stored.permissionPolicy || runtime.permissionPolicy) {
    merged.permissionPolicy = mergePermissionPolicy(stored.permissionPolicy, runtime.permissionPolicy);
  }

  return merged;
}

export function resolveAgentPermissionPolicy(config: AgentConfig): Required<AgentPermissionPolicy> {
  return mergePermissionPolicy(DEFAULT_AGENT_PERMISSION_POLICY, config.permissionPolicy);
}

export function buildPiRpcArgs(config: AgentConfig): string[] {
  const args: string[] = [];

  pushValue(args, "--system-prompt", config.systemPrompt);
  for (const prompt of config.appendSystemPrompt ?? []) {
    pushValue(args, "--append-system-prompt", prompt);
  }

  for (const skill of config.skills ?? []) {
    pushValue(args, "--skill", skill.path);
  }

  if (config.tools?.noTools) {
    args.push("--no-tools");
  }

  if (config.tools?.noBuiltinTools) {
    args.push("--no-builtin-tools");
  }

  pushValue(args, "--tools", config.tools?.allow?.join(","));
  pushValue(args, "--exclude-tools", config.tools?.deny?.join(","));

  return args;
}

function withoutUndefined(config: AgentConfig): AgentConfig {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) as AgentConfig;
}

function mergePermissionPolicy(
  stored: AgentPermissionPolicy | undefined,
  runtime: AgentPermissionPolicy | undefined
): Required<AgentPermissionPolicy> {
  return {
    ...DEFAULT_AGENT_PERMISSION_POLICY,
    ...stored,
    ...withoutUndefinedRecord(runtime ?? {})
  };
}

function pushValue(args: string[], flag: string, value: string | undefined): void {
  if (value) {
    args.push(flag, value);
  }
}

function withoutUndefinedRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
