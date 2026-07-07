import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_AGENT_PERMISSION_POLICY,
  DEFAULT_SYSTEM_PROMPT,
  buildPiRpcArgs,
  buildSkillContextPrompt,
  buildRuntimeToolConfig,
  mergeAgentConfig,
  resolveAgentPermissionPolicy
} from "../src/config/AgentConfig.js";

describe("Agent runtime config", () => {
  it("keeps system prompt, skills, MCP servers and permission policy in core config", () => {
    const config = mergeAgentConfig(
      {
        provider: "deepseek",
        model: "deepseek-chat",
        systemPrompt: "你是一个谨慎的编码智能体。",
        skills: [{ id: "review", name: "review", path: "/repo/.potato/skills/review", source: "local", enabled: true }],
        mcpServers: [{ name: "filesystem", command: "npx", args: ["@modelcontextprotocol/server-filesystem", "/repo"] }],
        permissionPolicy: {
          mode: "confirm",
          allow: ["read", "grep"],
          confirm: ["bash", "edit", "write"],
          deny: ["delete_file"]
        }
      },
      {
        model: "deepseek-reasoner",
        permissionPolicy: {
          mode: "bypass",
          allow: ["read", "grep", "bash", "edit", "write"]
        }
      }
    );

    expect(config).toMatchObject({
      provider: "deepseek",
      model: "deepseek-reasoner",
      systemPrompt: "你是一个谨慎的编码智能体。",
      skills: [{ id: "review", name: "review", path: "/repo/.potato/skills/review", source: "local", enabled: true }],
      mcpServers: [{ name: "filesystem", command: "npx", args: ["@modelcontextprotocol/server-filesystem", "/repo"] }],
      permissionPolicy: {
        mode: "bypass",
        allow: ["read", "grep", "bash", "edit", "write"],
        confirm: ["bash", "edit", "write"],
        deny: ["delete_file"]
      }
    });
  });

  it("defaults to confirm before mutating tools and exposes Pi RPC CLI args", () => {
    expect(DEFAULT_AGENT_PERMISSION_POLICY).toEqual({
      mode: "confirm",
      allow: ["read", "ls", "grep", "find"],
      confirm: ["bash", "edit", "write"],
      deny: []
    });

    expect(resolveAgentPermissionPolicy({})).toEqual(DEFAULT_AGENT_PERMISSION_POLICY);

    const args = buildPiRpcArgs({
        systemPrompt: "系统提示词",
        appendSystemPrompt: ["追加规则"],
        permissionPolicy: { mode: "bypass" },
        skills: [
          { id: "review", name: "review", path: "/repo/.potato/skills/review", source: "local", enabled: true },
          { id: "disabled", name: "disabled", path: "/repo/.potato/skills/disabled", source: "local", enabled: false }
        ],
        tools: { allow: ["read", "grep"], deny: ["bash"] }
      });

    expect(args).toEqual([
      "--system-prompt",
      expect.stringContaining("系统提示词"),
      "--append-system-prompt",
      "追加规则",
      "--no-skills",
      "--skill",
      "/repo/.potato/skills/review",
      "--tools",
      "read,grep",
      "--exclude-tools",
      "bash"
    ]);
    expect(args[1]).toContain("Potato managed skills:");
  });

  it("uses a Potato system identity by default", () => {
    expect(mergeAgentConfig({}, {})).toEqual({ systemPrompt: DEFAULT_SYSTEM_PROMPT });
    expect(buildPiRpcArgs({ permissionPolicy: { mode: "confirm" } })).toEqual([
      "--system-prompt",
      DEFAULT_SYSTEM_PROMPT,
      "--tools",
      "read,ls,grep,find,bash,edit,write"
    ]);
  });

  it("maps permission modes to the tools Pi is allowed to execute", () => {
    expect(buildRuntimeToolConfig({ permissionPolicy: { mode: "confirm" } })).toEqual({
      allow: ["read", "ls", "grep", "find", "bash", "edit", "write"],
      deny: []
    });

    expect(buildRuntimeToolConfig({ permissionPolicy: { mode: "readonly" } })).toEqual({
      allow: ["read", "ls", "grep", "find"],
      deny: ["bash", "edit", "write"]
    });

    expect(buildRuntimeToolConfig({ permissionPolicy: { mode: "bypass" } })).toEqual({
      allow: ["read", "ls", "grep", "find", "bash", "edit", "write"],
      deny: []
    });
  });

  it("exposes mutating tools to Pi in manual mode so runtime approval can gate them", () => {
    expect(buildPiRpcArgs({ permissionPolicy: { mode: "confirm" } })).toEqual([
      "--system-prompt",
      DEFAULT_SYSTEM_PROMPT,
      "--tools",
      "read,ls,grep,find,bash,edit,write"
    ]);
  });

  it("materializes manual approval extension with file diff preview", () => {
    const workspace = mkdtempSync(join(tmpdir(), "coding-agent-approval-"));
    const args = buildPiRpcArgs({ workspacePath: workspace, permissionPolicy: { mode: "confirm" } });
    const extensionPaths = extensionArgs(args);
    const extensionPath = extensionPaths.find((path) => path.endsWith("potato-approval.ts"));

    expect(extensionPath).toBeTruthy();
    const source = readFileSync(extensionPath as string, "utf8");
    expect(source).toContain("formatWritePreview");
    expect(source).toContain("simpleUnifiedDiff");
  });

  it("loads Potato product extensions into Pi RPC", () => {
    const workspace = mkdtempSync(join(tmpdir(), "potato-pi-extensions-"));
    const args = buildPiRpcArgs({
      workspacePath: workspace,
      permissionPolicy: { mode: "confirm" },
      mcpServers: [{ name: "filesystem", command: "npx", args: ["@modelcontextprotocol/server-filesystem", workspace] }],
      subAgents: [
        {
          id: "reviewer",
          name: "Reviewer",
          description: "Review code for correctness.",
          systemPrompt: "Review only. Do not modify files.",
          tools: { allow: ["read", "grep", "find", "ls"] },
          permissionPolicy: { mode: "readonly" },
          enabled: true
        }
      ]
    });

    const extensionPaths = extensionArgs(args);
    expect(extensionPaths.some((path) => path.endsWith("potato-approval.ts"))).toBe(true);
    expect(extensionPaths.some((path) => path.endsWith("potato-mcp-bridge.ts"))).toBe(true);
    expect(extensionPaths.some((path) => path.endsWith("subagent/index.ts"))).toBe(true);
    expect(args[1]).toContain("Use the subagent tool with agentScope=\"project\"");

    const agentPath = join(workspace, ".pi", "agents", "reviewer.md");
    expect(existsSync(agentPath)).toBe(true);
    expect(readFileSync(agentPath, "utf8")).toContain("name: reviewer");
    expect(readFileSync(agentPath, "utf8")).toContain("tools: read, grep, find, ls");

    const mcpSource = readFileSync(extensionPaths.find((path) => path.endsWith("potato-mcp-bridge.ts")) as string, "utf8");
    expect(mcpSource).toContain("new Client");
    expect(mcpSource).toContain("pi.registerTool");
    expect(mcpSource).toContain("${server.name}__${mcpTool.name}");
  });

  it("disables Pi skill auto-discovery when runtime skills are managed explicitly", () => {
    const args = buildPiRpcArgs({
        skills: [
          { id: "enabled", name: "enabled", path: "/repo/.potato/skills/.builtin/enabled", source: "builtin", enabled: true },
          { id: "disabled", name: "disabled", path: "/repo/.potato/skills/.builtin/disabled", source: "builtin", enabled: false }
        ]
      });

    expect(args).toEqual([
      "--system-prompt",
      expect.stringContaining(DEFAULT_SYSTEM_PROMPT),
      "--no-skills",
      "--skill",
      "/repo/.potato/skills/.builtin/enabled",
      "--tools",
      "read,ls,grep,find,bash,edit,write"
    ]);
    expect(args[1]).toContain("Potato managed skills:");
  });

  it("adds managed skills to visible runtime context as well as Pi skill paths", () => {
    expect(
      buildSkillContextPrompt([
        { id: "enabled", name: "Enabled Skill", path: "/repo/.potato/skills/enabled", source: "local", enabled: true },
        { id: "disabled", name: "Disabled Skill", path: "/repo/.potato/skills/disabled", source: "local", enabled: false }
      ])
    ).toBe(
      [
        "Potato managed skills:",
        "- enabled: Enabled Skill (local) enabled path=/repo/.potato/skills/enabled",
        "- disabled: Disabled Skill (local) disabled path=/repo/.potato/skills/disabled",
        "Only use enabled skills unless the user explicitly enables or mentions a disabled skill for the current turn."
      ].join("\n")
    );

    const args = buildPiRpcArgs({
        skills: [
          { id: "enabled", name: "Enabled Skill", path: "/repo/.potato/skills/enabled", source: "local", enabled: true },
          { id: "disabled", name: "Disabled Skill", path: "/repo/.potato/skills/disabled", source: "local", enabled: false }
        ]
      });
    expect(args[1]).toContain("Potato managed skills:");
  });
});

function extensionArgs(args: string[]): string[] {
  const paths: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--extension" && args[index + 1]) {
      paths.push(args[index + 1]);
    }
  }
  return paths;
}
