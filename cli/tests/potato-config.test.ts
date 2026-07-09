import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { loadPotatoConfig } from "../src/config/potatoConfig.js";

describe("loadPotatoConfig", () => {
  it("uses default enhancement config when .potato/config.json is absent", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "potato-config-"));
    try {
      await expect(loadPotatoConfig(cwd)).resolves.toEqual({ approval: true });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("loads enhancement config from .potato/config.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "potato-config-"));
    try {
      await mkdir(join(cwd, ".potato"));
      await writeFile(
        join(cwd, ".potato", "config.json"),
        JSON.stringify({
          enhancements: {
            approval: false,
            mcpServers: [{ name: "docs", command: "npx", args: ["mcp-docs"] }],
            subagents: [{ id: "reviewer", description: "Review code", systemPrompt: "You review code." }]
          }
        }),
        { encoding: "utf8", flush: true }
      );

      await expect(loadPotatoConfig(cwd)).resolves.toEqual({
        approval: false,
        mcpServers: [{ name: "docs", command: "npx", args: ["mcp-docs"] }],
        subagents: [{ id: "reviewer", description: "Review code", systemPrompt: "You review code." }]
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
