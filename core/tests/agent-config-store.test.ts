import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

      const raw = await readFile(join(workspace, ".potato", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKey: "secret"
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("does not persist or load user configured systemPrompt", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-config-system-prompt-"));
    try {
      const store = new FileAgentConfigStore(workspace);
      await store.save({ provider: "deepseek", systemPrompt: "user should not configure this" } as Parameters<FileAgentConfigStore["save"]>[0] & { systemPrompt: string });

      await expect(store.load()).resolves.toEqual({ provider: "deepseek" });
      const raw = await readFile(join(workspace, ".potato", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({ provider: "deepseek" });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("drops legacy systemPrompt from existing config files", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-config-legacy-system-prompt-"));
    try {
      await mkdir(join(workspace, ".potato"), { recursive: true });
      await writeFile(join(workspace, ".potato", "config.json"), JSON.stringify({ provider: "deepseek", systemPrompt: "legacy" }), "utf8");
      const store = new FileAgentConfigStore(workspace);

      await expect(store.load()).resolves.toEqual({ provider: "deepseek" });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });


  it("loads POTATO.md as transient project instructions without saving it into config", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-config-instructions-"));
    try {
      await writeFile(join(workspace, "POTATO.md"), "Always run focused tests before final answers.\n", "utf8");
      const store = new FileAgentConfigStore(workspace);

      await expect(store.load()).resolves.toEqual({
        projectInstructions: "Always run focused tests before final answers."
      });

      await store.save({ provider: "deepseek", projectInstructions: "do not persist" });
      const raw = await readFile(join(workspace, ".potato", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({ provider: "deepseek" });
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
      const raw = await readFile(join(workspace, ".potato", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({});
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
