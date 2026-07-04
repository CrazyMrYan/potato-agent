import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PERMISSION_POLICY,
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
        skills: [{ id: "review", name: "review", path: "/repo/.coding-agent/skills/review", source: "local", enabled: true }],
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
      skills: [{ id: "review", name: "review", path: "/repo/.coding-agent/skills/review", source: "local", enabled: true }],
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
          { id: "review", name: "review", path: "/repo/.coding-agent/skills/review", source: "local", enabled: true },
          { id: "disabled", name: "disabled", path: "/repo/.coding-agent/skills/disabled", source: "local", enabled: false }
        ],
        tools: { allow: ["read", "grep"], deny: ["bash"] }
      })
    ).toEqual([
      "--system-prompt",
      "系统提示词",
      "--append-system-prompt",
      "追加规则",
      "--skill",
      "/repo/.coding-agent/skills/review",
      "--tools",
      "read,grep",
      "--exclude-tools",
      "bash"
    ]);
  });

  it("maps permission modes to the tools Pi is allowed to execute", () => {
    expect(buildRuntimeToolConfig({ permissionPolicy: { mode: "confirm" } })).toEqual({
      allow: ["read", "ls", "grep", "find"],
      deny: ["bash", "edit", "write"]
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

  it("does not expose mutating tools to Pi in manual mode", () => {
    expect(buildPiRpcArgs({ permissionPolicy: { mode: "confirm" } })).toEqual(["--tools", "read,ls,grep,find", "--exclude-tools", "bash,edit,write"]);
  });
});
