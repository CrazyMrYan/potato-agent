import { describe, expect, it, vi } from "vitest";
import { McpToolRegistry } from "../src/mcp/McpToolRegistry.js";

describe("McpToolRegistry", () => {
  it("maps MCP listTools and callTool into AI SDK tools", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "search result" }] }));
    const registry = new McpToolRegistry(
      [{ name: "search", command: "npx", args: ["mcp-search"] }],
      {
        connect: async () => ({
          listTools: async () => ({
            tools: [
              {
                name: "web_search",
                description: "Search the web",
                inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
              }
            ]
          }),
          callTool,
          close: async () => {}
        })
      }
    );

    const tools = await registry.loadTools();
    expect(Object.keys(tools)).toEqual(["search__web_search"]);
    await expect(tools.search__web_search.execute?.({ query: "potato" }, {} as never)).resolves.toEqual("search result");
    expect(callTool).toHaveBeenCalledWith({ name: "web_search", arguments: { query: "potato" } });

    await registry.close();
  });

  it("normalizes non-object AI SDK tool input before calling MCP", async () => {
    const callTool = vi.fn(async () => ({ toolResult: { ok: true } }));
    const registry = new McpToolRegistry(
      [{ name: "search", command: "npx", args: ["mcp-search"] }],
      {
        connect: async () => ({
          listTools: async () => ({
            tools: [{ name: "web_search", inputSchema: { type: "object" } }]
          }),
          callTool,
          close: async () => {}
        })
      }
    );

    const tools = await registry.loadTools();
    await expect(tools.search__web_search.execute?.("bad-input", {} as never)).resolves.toEqual({ ok: true });
    expect(callTool).toHaveBeenCalledWith({ name: "web_search", arguments: {} });
  });

  it("resolves MCP server env mappings from process env for stdio transport", async () => {
    const createdTransports: unknown[] = [];
    const registry = new McpToolRegistry(
      [{ name: "search", command: "npx", args: ["mcp-search"], env: { API_KEY: "SEARCH_API_KEY" } }],
      {
        env: { SEARCH_API_KEY: "secret" },
        createClient: () => ({
          connect: async (transport: unknown) => {
            createdTransports.push(transport);
          },
          listTools: async () => ({ tools: [] }),
          callTool: async () => ({ content: [] }),
          close: async () => {}
        }),
        createStdioTransport: (options) => options
      }
    );

    await registry.loadTools();

    expect(createdTransports).toEqual([
      expect.objectContaining({
        command: "npx",
        args: ["mcp-search"],
        env: { API_KEY: "secret" }
      })
    ]);
  });
});
