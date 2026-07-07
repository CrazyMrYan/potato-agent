import { ensurePotatoPiRuntime } from "../pi/PotatoPiRuntime.js";
import type { SubAgentConfig } from "../subagent/SubAgentConfig.js";

export type AgentConfig = {
  adapter?: "rpc" | "runtime" | "sdk";
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
  subAgents?: SubAgentConfig[];
  activeSubAgentId?: string;
  ui?: AgentUiConfig;
};

export type ResolvedAgentConfig = Required<Pick<AgentConfig, "provider" | "model" | "apiKey" | "workspacePath">> &
  Pick<AgentConfig, "timeoutMs">;

export type AgentSkillConfig = {
  id?: string;
  name?: string;
  path: string;
  source?: "builtin" | "local" | "git";
  enabled?: boolean;
  repoUrl?: string;
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

export type AgentUiConfig = {
  details?: {
    thinking?: boolean;
    tool?: boolean;
    diff?: boolean;
  };
};

export const DEFAULT_AGENT_PERMISSION_POLICY: Required<AgentPermissionPolicy> = {
  mode: "confirm",
  allow: ["read", "ls", "grep", "find"],
  confirm: ["bash", "edit", "write"],
  deny: []
};

export const DEFAULT_SYSTEM_PROMPT = [
  "You are Potato, a coding agent for software engineering work.",
  "You help users understand, edit, test, and ship code in the current workspace.",
  "When asked who you are, identify yourself as Potato, not Pi Coding Agent.",
  "Be direct, technically rigorous, and do not claim capabilities that the active adapter does not support."
].join("\n");

const MUTATING_BUILTIN_TOOLS = ["bash", "edit", "write"];

export function mergeAgentConfig(stored: AgentConfig, runtime: AgentConfig): AgentConfig {
  const merged = {
    ...stored,
    ...withoutUndefined(runtime)
  };

  if (stored.permissionPolicy || runtime.permissionPolicy) {
    merged.permissionPolicy = mergePermissionPolicy(stored.permissionPolicy, runtime.permissionPolicy);
  }

  merged.systemPrompt = merged.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  return merged;
}

export function resolveAgentPermissionPolicy(config: AgentConfig): Required<AgentPermissionPolicy> {
  return mergePermissionPolicy(DEFAULT_AGENT_PERMISSION_POLICY, config.permissionPolicy);
}

export function buildPiRpcArgs(config: AgentConfig): string[] {
  const args: string[] = [];
  const runtimeTools = buildRuntimeToolConfig(config);
  const potatoRuntime = ensurePotatoPiRuntime(config);

  pushValue(
    args,
    "--system-prompt",
    [config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, buildSkillContextPrompt(config.skills), ...potatoRuntime.systemPromptAdditions]
      .filter(Boolean)
      .join("\n\n")
  );
  for (const prompt of config.appendSystemPrompt ?? []) {
    pushValue(args, "--append-system-prompt", prompt);
  }

  if (config.skills) {
    args.push("--no-skills");
  }

  for (const skill of (config.skills ?? []).filter((skill) => skill.enabled !== false)) {
    pushValue(args, "--skill", skill.path);
  }

  if (config.tools?.noTools) {
    args.push("--no-tools");
  }

  if (config.tools?.noBuiltinTools) {
    args.push("--no-builtin-tools");
  }

  pushValue(args, "--tools", runtimeTools.allow?.join(","));
  pushValue(args, "--exclude-tools", runtimeTools.deny?.join(","));
  for (const extensionPath of potatoRuntime.extensionPaths) {
    pushValue(args, "--extension", extensionPath);
  }

  return args;
}

export function buildSkillContextPrompt(skills: AgentSkillConfig[] | undefined): string | undefined {
  if (!skills || skills.length === 0) {
    return undefined;
  }

  return [
    "Potato managed skills:",
    ...skills.map((skill) => {
      const id = skill.id ?? skill.name ?? skill.path;
      const name = skill.name ?? id;
      const source = skill.source ?? "local";
      const status = skill.enabled === false ? "disabled" : "enabled";
      return `- ${id}: ${name} (${source}) ${status} path=${skill.path}`;
    }),
    "Only use enabled skills unless the user explicitly enables or mentions a disabled skill for the current turn."
  ].join("\n");
}

export function buildRuntimeToolConfig(config: AgentConfig): AgentToolConfig {
  const policy = resolveAgentPermissionPolicy(config);

  if (policy.mode === "readonly") {
    return {
      allow: unique(config.tools?.allow ?? policy.allow),
      deny: unique([...(config.tools?.deny ?? []), ...policy.confirm, ...policy.deny, ...MUTATING_BUILTIN_TOOLS])
    };
  }

  if (policy.mode === "bypass" || policy.mode === "confirm") {
    return {
      allow: unique(config.tools?.allow ?? [...policy.allow, ...policy.confirm]),
      deny: unique([...(config.tools?.deny ?? []), ...policy.deny])
    };
  }

  return { allow: unique(config.tools?.allow ?? policy.allow), deny: unique(config.tools?.deny ?? []) };
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

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function withoutUndefinedRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
