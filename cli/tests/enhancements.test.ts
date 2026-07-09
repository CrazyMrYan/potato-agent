import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createApprovalExtension } from "../src/enhancements/approval.js";
import { createMcpBridgeExtension } from "../src/enhancements/mcp.js";
import { createSubagentExtension } from "../src/enhancements/subagent.js";
import { buildEnhancementReport, createPotatoExtensionFactories } from "../src/enhancements/index.js";
import { launchPi } from "../src/pi/launchPi.js";

describe("Potato enhancements", () => {
  it("enables approval by default and passes extension factories to Pi", async () => {
    const main = vi.fn(async () => undefined);

    await launchPi(["--print", "hello"], { main });

    expect(main).toHaveBeenCalledTimes(1);
    expect(main.mock.calls[0]?.[1]?.extensionFactories?.length).toBeGreaterThan(0);
    expect(buildEnhancementReport({}).find((item) => item.id === "approval")?.enabled).toBe(true);
  });

  it("registers a tool_call approval hook for mutating tools", async () => {
    const pi = createFakePi();
    createApprovalExtension()(pi);

    expect(pi.handlers.tool_call).toHaveLength(1);

    const result = await pi.handlers.tool_call[0]?.(
      { type: "tool_call", toolCallId: "1", toolName: "bash", input: { command: "rm -rf dist" } },
      createFakeContext({ confirmed: false })
    );

    expect(result).toEqual({ block: true, reason: "Rejected by user." });
  });

  it("registers MCP tools from configured servers", async () => {
    const listTools = vi.fn(async () => ({
      tools: [{ name: "search", description: "Search docs", inputSchema: { type: "object", properties: {} } }]
    }));
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "result text" }] }));
    const pi = createFakePi();

    await createMcpBridgeExtension({
      servers: [{ name: "docs", command: "npx", args: ["mcp-docs"] }],
      createClient: async () => ({ listTools, callTool, close: async () => undefined })
    })(pi);

    expect(pi.tools.map((tool) => tool.name)).toEqual(["docs__search"]);

    const result = await pi.tools[0]?.execute("call_1", {}, undefined, undefined, createFakeContext());

    expect(callTool).toHaveBeenCalledWith({ name: "search", arguments: {} });
    expect(result?.content).toEqual([{ type: "text", text: "result text" }]);
  });

  it("registers a potato_subagent tool when subagents are configured", async () => {
    const runSubagent = vi.fn(async () => "subagent answer");
    const pi = createFakePi();

    createSubagentExtension({
      subagents: [{ id: "reviewer", description: "Review code", systemPrompt: "You review code." }],
      runSubagent
    })(pi);

    expect(pi.tools.map((tool) => tool.name)).toEqual(["potato_subagent"]);

    const result = await pi.tools[0]?.execute(
      "call_1",
      { agent: "reviewer", task: "Check this diff" },
      undefined,
      undefined,
      createFakeContext()
    );

    expect(runSubagent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: expect.objectContaining({ id: "reviewer" }), task: "Check this diff" })
    );
    expect(result?.content).toEqual([{ type: "text", text: "subagent answer" }]);
  });

  it("builds factories for enabled MCP and subagent config", () => {
    const factories = createPotatoExtensionFactories({
      mcpServers: [{ name: "docs", command: "npx", args: ["mcp-docs"] }],
      subagents: [{ id: "reviewer", description: "Review code", systemPrompt: "You review code." }]
    });

    expect(factories).toHaveLength(3);
    expect(buildEnhancementReport({ mcpServers: [{ name: "docs", command: "npx" }] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "mcp", enabled: true })])
    );
  });
});

function createFakePi() {
  return {
    handlers: { tool_call: [] as Array<(event: any, ctx: ExtensionContext) => any>, session_shutdown: [] as Array<() => any> },
    tools: [] as any[],
    on(event: string, handler: any) {
      if (event === "tool_call") this.handlers.tool_call.push(handler);
      if (event === "session_shutdown") this.handlers.session_shutdown.push(handler);
    },
    registerTool(tool: any) {
      this.tools.push(tool);
    }
  } as unknown as ExtensionAPI & {
    handlers: { tool_call: Array<(event: any, ctx: ExtensionContext) => any>; session_shutdown: Array<() => any> };
    tools: any[];
  };
}

function createFakeContext(options: { confirmed?: boolean } = {}): ExtensionContext {
  return {
    cwd: "/repo",
    hasUI: true,
    ui: {
      confirm: async () => options.confirmed ?? true,
      notify: () => undefined
    }
  } as ExtensionContext;
}
