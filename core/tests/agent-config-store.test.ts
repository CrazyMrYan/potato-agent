import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDefaultAgentConfig, FileAgentConfigStore, mergeAgentConfig } from "../src/config/AgentConfigStore.js";

describe("FileAgentConfigStore", () => {
  it("returns an empty config when no config file exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-config-empty-"));
    try {
      const store = new FileAgentConfigStore(workspace);
      await expect(store.load()).resolves.toEqual({});
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("saves and loads workspace model config", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-config-save-"));
    try {
      const store = new FileAgentConfigStore(workspace);
      await store.save({ provider: "deepseek", model: "deepseek-reasoner", apiKey: "secret" });

      await expect(store.load()).resolves.toEqual({
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKey: "secret"
      });

      const raw = await readFile(join(workspace, ".coding-agent", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKey: "secret"
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("mergeAgentConfig", () => {
  it("prefers runtime values over stored values and keeps workspace path", () => {
    expect(
      mergeAgentConfig(
        { provider: "deepseek", model: "deepseek-chat", apiKey: "stored", workspacePath: "/repo" },
        { model: "deepseek-reasoner", apiKey: "runtime" }
      )
    ).toEqual({
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKey: "runtime",
      workspacePath: "/repo"
    });
  });
});

describe("ensureDefaultAgentConfig", () => {
  it("creates a default config file when missing", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-config-default-"));
    try {
      const config = await ensureDefaultAgentConfig(new FileAgentConfigStore(workspace));

      expect(config).toEqual({});
      const raw = await readFile(join(workspace, ".coding-agent", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({});
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
