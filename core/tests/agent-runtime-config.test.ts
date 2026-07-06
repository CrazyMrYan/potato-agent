import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_AGENT_PERMISSION_POLICY,
  DEFAULT_SYSTEM_PROMPT,
  buildPiRpcArgs,
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

    expect(
      buildPiRpcArgs({
        systemPrompt: "系统提示词",
        appendSystemPrompt: ["追加规则"],
        permissionPolicy: { mode: "bypass" },
        skills: [
          { id: "review", name: "review", path: "/repo/.potato/skills/review", source: "local", enabled: true },
          { id: "disabled", name: "disabled", path: "/repo/.potato/skills/disabled", source: "local", enabled: false }
        ],
        tools: { allow: ["read", "grep"], deny: ["bash"] }
      })
    ).toEqual([
      "--system-prompt",
      "系统提示词",
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
    const extensionPath = args.at(args.indexOf("--extension") + 1);

    expect(extensionPath).toBeTruthy();
    const source = readFileSync(extensionPath as string, "utf8");
    expect(source).toContain("formatWritePreview");
    expect(source).toContain("simpleUnifiedDiff");
  });

  it("disables Pi skill auto-discovery when runtime skills are managed explicitly", () => {
    expect(
      buildPiRpcArgs({
        skills: [
          { id: "enabled", name: "enabled", path: "/repo/.potato/skills/.builtin/enabled", source: "builtin", enabled: true },
          { id: "disabled", name: "disabled", path: "/repo/.potato/skills/.builtin/disabled", source: "builtin", enabled: false }
        ]
      })
    ).toEqual([
      "--system-prompt",
      DEFAULT_SYSTEM_PROMPT,
      "--no-skills",
      "--skill",
      "/repo/.potato/skills/.builtin/enabled",
      "--tools",
      "read,ls,grep,find,bash,edit,write"
    ]);
  });
});
