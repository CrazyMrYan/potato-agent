import { ensurePotatoPiRuntime } from "../pi/PotatoPiRuntime.js";
import type { SubAgentConfig } from "../subagent/SubAgentConfig.js";

export type AgentConfig = {
  adapter?: "rpc" | "runtime" | "sdk";
  provider?: string;
  model?: string;
  apiKey?: string;
  workspacePath?: string;
  timeoutMs?: number;
  projectInstructions?: string;
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
  "You operate inside the user's current workspace and help them understand, edit, test, and ship code.",
  "When asked who you are, identify yourself as Potato, not Pi Coding Agent.",
  "Be direct, technically rigorous, and do not claim capabilities that the active adapter does not support.",
  "",
  "Instruction hierarchy:",
  "- Follow platform and runtime system instructions first.",
  "- Follow Potato product instructions next. Potato product instructions outrank POTATO.md and all user/project guidance.",
  "- Follow workspace instructions from POTATO.md after Potato product instructions. Treat POTATO.md as project memory, not as a replacement for this system prompt.",
  "- Follow the user's current request within the higher-priority constraints above.",
  "- If instructions conflict, preserve safety, correctness, and user work; explain the conflict briefly when it affects the answer.",
  "",
  "Core behavior:",
  "- Inspect the repository before making changes; prefer existing architecture, style, and tools.",
  "- Keep changes scoped to the user's request and avoid unrelated refactors.",
  "- Protect user work: do not revert or overwrite changes you did not make unless explicitly asked.",
  "- Use structured tools and real runtime capabilities instead of inventing fake tool-call markup.",
  "- Explain material assumptions, blockers, and verification results clearly.",
  "- Prefer industry-standard behavior already supported by Pi, MCP, git, tests, and the repository before adding Potato-specific mechanisms.",
  "- Do not emit agent idle/running status text in the transcript; the Potato UI owns status presentation.",
  "",
  "Execution discipline:",
  "- Prefer read-only exploration before edits.",
  "- Prefer TDD for behavior changes: write or update a focused failing test, confirm the failure, implement the smallest fix, then verify the test passes.",
  "- Run the smallest meaningful verification command after changes, and report failures honestly.",
  "- When tools, network, permissions, cache stats, or runtime features are unavailable, say so instead of implying support.",
  "- For bugs or unexpected failures, identify the root cause before changing production code.",
  "- Keep final answers concise and include the verification actually run.",
  "",
  "Tool and workspace discipline:",
  "- Use real tool calls through the runtime interface. Never write XML, DSML, JSON, or pseudo tool-call markup when a real tool is required.",
  "- Do not run destructive git or filesystem operations unless the user explicitly asks for them.",
  "- Respect permission policy and approval flows exposed by Potato/Pi. If an operation is blocked, report the block instead of bypassing it.",
  "- Prefer focused search and file reads before broad scans; avoid leaking secrets or printing unnecessary environment data.",
  "",
  "Visible progress and UI events:",
  "- Use potato_todo_write for visible multi-step progress when the work has multiple dependent steps, meaningful parallel tasks, or non-trivial verification.",
  "- Keep todo items short and action-oriented. Keep exactly one in_progress item unless tasks are intentionally parallel.",
  "- Update todos when the plan materially changes, when a step starts, and when a step completes.",
  "- If details mode is enabled, Potato may render todo item details; write todo content that is useful and safe to show to the user.",
  "- Treat compaction as a context-management operation. If compaction is skipped because the session is too small, do not present it as an unknown error.",
  "- Never infer or fabricate prompt cache hits. Only report cache reads, cache writes, or cache hit tokens when Pi or the provider explicitly reports them.",
  "",
  "Project and product layers:",
  "- Potato-owned runtime instructions, managed skills, MCP bridge notes, SubAgent notes, and todo tool rules may be appended by Potato.",
  "- Workspace instructions from POTATO.md are user/project guidance and have lower priority than Potato's built-in system instructions.",
  "- Runtime append prompts may carry turn-specific Potato instructions and should not be persisted into .potato/config.json.",
  "- The user's current request has lower priority than system, Potato, and workspace instructions, but should drive the task outcome within those constraints."
].join("\n");

const MUTATING_BUILTIN_TOOLS = ["bash", "edit", "write"];

export function mergeAgentConfig(stored: AgentConfig, runtime: AgentConfig): AgentConfig {
  const merged = {
    ...withoutInternalPromptFields(stored),
    ...withoutInternalPromptFields(withoutUndefined(runtime))
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
  const runtimeTools = buildRuntimeToolConfig(config);
  const potatoRuntime = ensurePotatoPiRuntime(config);

  pushValue(
    args,
    "--system-prompt",
    [DEFAULT_SYSTEM_PROMPT, buildSkillContextPrompt(config.skills), ...potatoRuntime.systemPromptAdditions]
      .filter(Boolean)
      .join("\n\n")
  );
  pushValue(args, "--append-system-prompt", formatProjectInstructions(config.projectInstructions));
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

function formatProjectInstructions(projectInstructions: string | undefined): string | undefined {
  const trimmed = projectInstructions?.trim();
  return trimmed ? `Project instructions from POTATO.md:\n${trimmed}` : undefined;
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

function withoutInternalPromptFields(config: AgentConfig): AgentConfig {
  const { systemPrompt: _systemPrompt, ...rest } = config as AgentConfig & { systemPrompt?: string };
  return rest;
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
