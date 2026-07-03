import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PERMISSION_POLICY,
  buildPiRpcArgs,
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
        skills: [{ path: "/repo/.coding-agent/skills/review" }],
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
      skills: [{ path: "/repo/.coding-agent/skills/review" }],
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
        skills: [{ path: "/repo/.coding-agent/skills/review" }],
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
});
