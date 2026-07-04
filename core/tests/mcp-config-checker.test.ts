import { describe, expect, it, vi } from "vitest";
import { McpConfigChecker } from "../src/mcp/McpConfigChecker.js";

describe("McpConfigChecker", () => {
  it("reports adapter unsupported for Pi RPC even when config is otherwise valid", async () => {
    const checker = new McpConfigChecker({
      commandExists: async () => true,
      start: async () => ({ ok: true }),
      env: { API_KEY: "secret" },
      adapter: "rpc"
    });

    await expect(
      checker.check({ name: "test", command: "node", args: ["server.js"], env: { API_KEY: "API_KEY" } })
    ).resolves.toEqual({
      name: "test",
      status: "adapter-unsupported",
      message: "MCP is configured, but the current adapter does not support MCP injection."
    });
  });

  it("reports missing commands", async () => {
    const checker = new McpConfigChecker({
      commandExists: async () => false,
      adapter: "runtime"
    });

    await expect(checker.check({ name: "missing", command: "missing-command" })).resolves.toEqual({
      name: "missing",
      status: "missing-command",
      message: "Command not found: missing-command"
    });
  });

  it("reports missing env values", async () => {
    const checker = new McpConfigChecker({
      commandExists: async () => true,
      env: {},
      adapter: "runtime"
    });

    await expect(checker.check({ name: "env", command: "node", env: { API_KEY: "API_KEY" } })).resolves.toEqual({
      name: "env",
      status: "missing-env",
      message: "Missing environment variables: API_KEY"
    });
  });

  it("reports startup failures", async () => {
    const checker = new McpConfigChecker({
      commandExists: async () => true,
      start: async () => ({ ok: false, message: "boom" }),
      adapter: "runtime"
    });

    await expect(checker.check({ name: "bad", command: "node" })).resolves.toEqual({
      name: "bad",
      status: "startup-failed",
      message: "boom"
    });
  });

  it("reports ok when command, env, and startup checks pass", async () => {
    const start = vi.fn(async () => ({ ok: true }));
    const checker = new McpConfigChecker({
      commandExists: async () => true,
      start,
      env: { API_KEY: "secret" },
      adapter: "runtime"
    });

    await expect(checker.check({ name: "ok", command: "node", args: ["server.js"], env: { API_KEY: "API_KEY" } })).resolves.toEqual({
      name: "ok",
      status: "ok",
      message: "MCP server configuration is valid."
    });
    expect(start).toHaveBeenCalledWith({ command: "node", args: ["server.js"], env: { API_KEY: "secret" } });
  });
});
