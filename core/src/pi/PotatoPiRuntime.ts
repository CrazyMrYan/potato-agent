import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentConfig, AgentMcpServerConfig } from "../config/AgentConfig.js";
import type { SubAgentConfig } from "../subagent/SubAgentConfig.js";

export type PotatoPiRuntimeArtifacts = {
  extensionPaths: string[];
  systemPromptAdditions: string[];
};

export function ensurePotatoPiRuntime(config: AgentConfig): PotatoPiRuntimeArtifacts {
  if (!config.workspacePath || !existsSync(config.workspacePath)) {
    return { extensionPaths: [], systemPromptAdditions: [] };
  }

  const extensionPaths: string[] = [];
  const systemPromptAdditions: string[] = [];
  const policyMode = config.permissionPolicy?.mode ?? "confirm";

  extensionPaths.push(writeRuntimeExtension(config.workspacePath, "potato-todo.ts", POTATO_TODO_EXTENSION_SOURCE));
  systemPromptAdditions.push(POTATO_TODO_SYSTEM_PROMPT);

  if (policyMode === "confirm") {
    extensionPaths.push(writeRuntimeExtension(config.workspacePath, "potato-approval.ts", POTATO_APPROVAL_EXTENSION_SOURCE));
  }

  if ((config.mcpServers ?? []).length > 0) {
    extensionPaths.push(writeRuntimeExtension(config.workspacePath, "potato-mcp-bridge.ts", buildMcpBridgeExtension(config.mcpServers ?? [])));
    systemPromptAdditions.push(
      [
        "Potato MCP bridge:",
        "MCP servers are exposed as Pi custom tools named <server>__<tool>.",
        "Use those real tools instead of writing XML, DSML, or pseudo tool-call markup."
      ].join("\n")
    );
  }

  const projectSubAgents = (config.subAgents ?? []).filter((agent) => agent.id !== "default" && agent.enabled !== false);
  if (projectSubAgents.length > 0) {
    writeProjectSubAgents(config.workspacePath, projectSubAgents);
    extensionPaths.push(resolvePiSubagentExtensionPath());
    systemPromptAdditions.push(formatSubAgentRuntimePrompt(projectSubAgents));
  }

  return { extensionPaths, systemPromptAdditions };
}

function writeRuntimeExtension(workspacePath: string, fileName: string, source: string): string {
  const runtimeDir = join(workspacePath, ".potato", "runtime");
  mkdirSync(runtimeDir, { recursive: true });
  const extensionPath = join(runtimeDir, fileName);
  writeFileSync(extensionPath, source);
  return extensionPath;
}

function writeProjectSubAgents(workspacePath: string, agents: SubAgentConfig[]): void {
  const agentsDir = join(workspacePath, ".pi", "agents");
  mkdirSync(agentsDir, { recursive: true });
  for (const agent of agents) {
    writeFileSync(join(agentsDir, `${agent.id}.md`), formatSubAgentMarkdown(agent));
  }
}

function formatSubAgentMarkdown(agent: SubAgentConfig): string {
  const tools = agent.tools?.allow?.join(", ");
  const frontmatter = [
    "---",
    `name: ${escapeYamlScalar(agent.id)}`,
    `description: ${escapeYamlScalar(agent.description)}`,
    tools ? `tools: ${escapeYamlScalar(tools)}` : undefined,
    "---"
  ].filter(Boolean);

  return [...frontmatter, "", agent.systemPrompt ?? `Act as ${agent.name}. ${agent.description}`, ""].join("\n");
}

function formatSubAgentRuntimePrompt(agents: SubAgentConfig[]): string {
  return [
    "Potato subagents:",
    ...agents.map((agent) => `- ${agent.id}: ${agent.description}`),
    'Use the subagent tool with agentScope="project" when delegation would help.',
    "For review, planning, or debugging work, delegate focused tasks to an appropriate subagent and summarize its result for the user."
  ].join("\n");
}

function resolvePiSubagentExtensionPath(): string {
  const piIndexPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(dirname(piIndexPath)), "examples", "extensions", "subagent", "index.ts");
}

function buildMcpBridgeExtension(servers: AgentMcpServerConfig[]): string {
  return `import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type } from "typebox";

const SERVERS = ${JSON.stringify(servers, null, 2)};
const connections = [];

export default async function potatoMcpBridge(pi) {
  for (const server of SERVERS) {
    try {
      const client = new Client({ name: "potato-pi-mcp-bridge", version: "0.1.0" });
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args || [],
        env: resolveServerEnv(server.env),
        stderr: "pipe"
      });
      await client.connect(transport);
      connections.push(client);
      const listed = await client.listTools();
      for (const mcpTool of listed.tools || []) {
        const toolName = sanitizeToolName(\`\${server.name}__\${mcpTool.name}\`);
        pi.registerTool({
          name: toolName,
          label: toolName,
          description: mcpTool.description || \`MCP tool \${mcpTool.name} from \${server.name}\`,
          parameters: toTypeboxSchema(mcpTool.inputSchema),
          async execute(_toolCallId, params) {
            const result = await client.callTool({ name: mcpTool.name, arguments: params || {} });
            return {
              content: [{ type: "text", text: formatMcpResult(result) }],
              details: { server: server.name, tool: mcpTool.name, raw: result }
            };
          }
        });
      }
    } catch (error) {
      pi.on("session_start", (_event, ctx) => {
        ctx.ui.notify(\`MCP bridge failed for \${server.name}: \${error instanceof Error ? error.message : String(error)}\`, "error");
      });
    }
  }

  pi.on("session_shutdown", async () => {
    await Promise.all(connections.splice(0).map((client) => client.close().catch(() => undefined)));
  });
}

function resolveServerEnv(config) {
  if (!config) return process.env;
  return Object.fromEntries(Object.entries(config).map(([name, envName]) => [name, process.env[envName] || ""]));
}

function toTypeboxSchema(schema) {
  if (schema && schema.type === "object") return Type.Unsafe(schema);
  return Type.Object({}, { additionalProperties: true });
}

function sanitizeToolName(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function formatMcpResult(result) {
  if (result && result.structuredContent !== undefined) return JSON.stringify(result.structuredContent, null, 2);
  if (result && result.toolResult !== undefined) return typeof result.toolResult === "string" ? result.toolResult : JSON.stringify(result.toolResult, null, 2);
  const text = result && Array.isArray(result.content)
    ? result.content.filter((item) => item.type === "text" && item.text).map((item) => item.text).join("\\n")
    : "";
  return text || JSON.stringify(result, null, 2);
}
`;
}

function escapeYamlScalar(value: string): string {
  return /^[a-zA-Z0-9 _.,:/@-]+$/.test(value) ? value : JSON.stringify(value);
}

const POTATO_TODO_SYSTEM_PROMPT = [
  "Potato todo tool:",
  "Use potato_todo_write for multi-step work that needs visible progress tracking.",
  "Keep todos short, action-oriented, and update status as work progresses.",
  "Use exactly one in_progress todo at a time unless the work is intentionally parallel."
].join("\n");

const POTATO_TODO_EXTENSION_SOURCE = `import { Type } from "typebox";

let todos = [];

export default function potatoTodoExtension(pi) {
  pi.registerTool({
    name: "potato_todo_write",
    label: "Update todo list",
    description: "Replace the visible Potato todo list for the current task. Use this for multi-step coding work.",
    parameters: Type.Object({
      todos: Type.Array(Type.Object({
        content: Type.String(),
        status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
        activeForm: Type.Optional(Type.String())
      }))
    }),
    async execute(_toolCallId, params) {
      todos = Array.isArray(params && params.todos) ? params.todos.map(normalizeTodo).filter(Boolean) : [];
      return {
        content: [{ type: "text", text: \`Todo list updated: \${todos.length} item(s).\` }],
        details: { kind: "potato.todo", todos }
      };
    }
  });
}

function normalizeTodo(todo) {
  if (!todo || typeof todo.content !== "string") return undefined;
  const status = ["pending", "in_progress", "completed"].includes(todo.status) ? todo.status : "pending";
  return {
    content: todo.content,
    status,
    ...(typeof todo.activeForm === "string" ? { activeForm: todo.activeForm } : {})
  };
}
`;

const POTATO_APPROVAL_EXTENSION_SOURCE = `import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

export default function potatoApprovalExtension(pi) {
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
  const path = input && typeof input.path === "string" ? input.path : input && typeof input.file_path === "string" ? input.file_path : undefined;
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
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
`;
