import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTuiConfig, runTuiCommand } from "../src/commands/tui.js";

describe("createTuiConfig", () => {
  it("defaults workspace to the current process directory", () => {
    expect(createTuiConfig({ cwd: "/repo" })).toEqual({ workspacePath: "/repo" });
  });

  it("uses provided runtime model config", () => {
    expect(
      createTuiConfig({
        cwd: "/repo",
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKey: "secret"
      })
    ).toEqual({
      workspacePath: "/repo",
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKey: "secret",
      timeoutMs: undefined
    });
  });
});

describe("runTuiCommand", () => {
  it("passes normalized config to renderer", async () => {
    const render = vi.fn();
    await runTuiCommand({ cwd: "/repo", provider: "deepseek", model: "deepseek-chat" }, { render, loadConfig: async () => ({}) });

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: "/repo", provider: "deepseek" }));
  });

  it("loads stored model config and lets runtime config win", async () => {
    const render = vi.fn();
    await runTuiCommand(
      { cwd: "/repo", model: "runtime-model" },
      {
        render,
        loadConfig: async () => ({
          provider: "deepseek",
          model: "stored-model",
          apiKey: "stored-key"
        })
      }
    );

    expect(render).toHaveBeenCalledWith({
      workspacePath: "/repo",
      provider: "deepseek",
      model: "runtime-model",
      apiKey: "stored-key",
      timeoutMs: undefined
    });
  });

  it("loads configuration through the default config initializer seam", async () => {
    const render = vi.fn();
    const loadConfig = vi.fn(async () => ({}));

    await runTuiCommand({ cwd: "/repo" }, { render, loadConfig });

    expect(loadConfig).toHaveBeenCalledWith("/repo");
    expect(render).toHaveBeenCalledWith({ workspacePath: "/repo" });
  });

  it("creates a default workspace config file on startup", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-tui-config-"));
    const render = vi.fn();

    try {
      await runTuiCommand({ cwd: workspace }, { render });

      const raw = await readFile(join(workspace, ".coding-agent", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({});
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
