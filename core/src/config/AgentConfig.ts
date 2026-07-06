import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SubAgentConfig } from "../subagent/SubAgentConfig.js";

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
  subAgents?: SubAgentConfig[];
  activeSubAgentId?: string;
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
  const policy = resolveAgentPermissionPolicy(config);

  pushValue(args, "--system-prompt", config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
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
  if (policy.mode === "confirm" && config.workspacePath) {
    pushValue(args, "--extension", ensureManualApprovalExtension(config.workspacePath));
  }

  return args;
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

function ensureManualApprovalExtension(workspacePath: string): string {
  const runtimeDir = join(workspacePath, ".potato", "runtime");
  const extensionPath = join(runtimeDir, "manual-approval-extension.ts");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(extensionPath, MANUAL_APPROVAL_EXTENSION_SOURCE);
  return extensionPath;
}

const MANUAL_APPROVAL_EXTENSION_SOURCE = `import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

export default function manualApprovalExtension(pi) {
  pi.on("tool_call", async (event, ctx) => {
    if (!MUTATING_TOOLS.has(event.toolName)) return undefined;
    if (!ctx.hasUI) {
      return { block: true, reason: "Manual approval required, but no UI is attached." };
    }

    const input = formatApprovalDetail(event, ctx.cwd);
    const confirmed = await ctx.ui.confirm(
      \`Approve \${event.toolName}?\`,
      input
    );

    if (!confirmed) {
      return { block: true, reason: "Rejected by user." };
    }

    return undefined;
  });
}

function formatApprovalDetail(event, cwd) {
  if (event.toolName === "write") {
    return formatWritePreview(event.input, cwd);
  }
  if (event.toolName === "edit") {
    return formatEditPreview(event.input, cwd);
  }
  return formatInput(event.input);
}

function formatWritePreview(input, cwd) {
  const path = input && typeof input.path === "string" ? input.path : undefined;
  const content = input && typeof input.content === "string" ? input.content : undefined;
  if (!path || content === undefined) return formatInput(input);
  const absolutePath = resolvePath(cwd, path);
  const oldContent = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
  return \`File: \${path}\\n\${simpleUnifiedDiff(path, oldContent, content)}\`;
}

function formatEditPreview(input, cwd) {
  const path = input && typeof input.path === "string" ? input.path : input && typeof input.file_path === "string" ? input.file_path : undefined;
  if (!path) return formatInput(input);
  const absolutePath = resolvePath(cwd, path);
  if (!existsSync(absolutePath)) return \`File: \${path}\\nCannot preview: file does not exist.\`;
  const oldContent = readFileSync(absolutePath, "utf8");
  const nextContent = applyEditPreview(oldContent, input);
  if (nextContent === undefined) return formatInput(input);
  return \`File: \${path}\\n\${simpleUnifiedDiff(path, oldContent, nextContent)}\`;
}

function applyEditPreview(content, input) {
  const edits = Array.isArray(input && input.edits)
    ? input.edits
    : input && typeof input.oldText === "string" && typeof input.newText === "string"
      ? [{ oldText: input.oldText, newText: input.newText }]
      : [];
  let next = content;
  for (const edit of edits) {
    if (!edit || typeof edit.oldText !== "string" || typeof edit.newText !== "string") return undefined;
    next = next.replace(edit.oldText, edit.newText);
  }
  return next;
}

function simpleUnifiedDiff(path, oldContent, newContent) {
  if (oldContent === newContent) return "No content changes detected.";
  const oldLines = oldContent.split("\\n");
  const newLines = newContent.split("\\n");
  const lines = [\`--- a/\${path}\`, \`+++ b/\${path}\`];
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index++) {
    if (oldLines[index] === newLines[index]) {
      if (oldLines[index] !== undefined && lines.length < 80) lines.push(\` \${oldLines[index]}\`);
      continue;
    }
    if (oldLines[index] !== undefined) lines.push(\`-\${oldLines[index]}\`);
    if (newLines[index] !== undefined) lines.push(\`+\${newLines[index]}\`);
    if (lines.length >= 80) {
      lines.push("... diff truncated ...");
      break;
    }
  }
  return lines.join("\\n");
}

function resolvePath(cwd, path) {
  return isAbsolute(path) ? path : join(cwd, path);
}

function formatInput(input) {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}
`;
