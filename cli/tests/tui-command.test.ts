import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createTuiConfig, runTuiCommand } from "../src/commands/tui.js";

describe("createTuiConfig", () => {
  it("uses a resolved workspace when one is provided", () => {
    expect(createTuiConfig({ cwd: "/repo", resolvedWorkspacePath: "/repo-root" })).toEqual({
      workspacePath: "/repo-root",
      provider: undefined,
      model: undefined,
      apiKey: undefined,
      timeoutMs: undefined
    });
  });

  it("uses provided runtime model config", () => {
    expect(
      createTuiConfig({
        resolvedWorkspacePath: "/repo",
        adapter: "rpc",
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
    await runTuiCommand(
      { cwd: "/repo", provider: "deepseek", model: "deepseek-chat" },
      { render, loadConfig: async () => ({}), resolveWorkspacePath: async () => "/repo-root" }
    );

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: "/repo-root", provider: "deepseek" }));
  });

  it("loads stored model config and lets runtime config win", async () => {
    const render = vi.fn();
    await runTuiCommand(
      { cwd: "/repo", model: "runtime-model" },
      {
        render,
        resolveWorkspacePath: async () => "/repo",
        loadConfig: async () => ({
          provider: "deepseek",
          model: "stored-model",
          apiKey: "stored-key"
        })
      }
    );

    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: "/repo",
        provider: "deepseek",
        model: "runtime-model",
        apiKey: "stored-key"
      })
    );
  });

  it("ignores stored adapter selection so TUI uses the default standard runtime", async () => {
    const render = vi.fn();
    await runTuiCommand(
      { cwd: "/repo" },
      {
        render,
        resolveWorkspacePath: async () => "/repo",
        loadConfig: async () => ({
          adapter: "rpc",
          provider: "deepseek",
          model: "stored-model"
        })
      }
    );

    const renderedConfig = render.mock.calls[0]?.[0];
    expect(renderedConfig).toEqual(expect.objectContaining({ provider: "deepseek" }));
    expect(renderedConfig).not.toHaveProperty("adapter");
  });

  it("loads configuration through the default config initializer seam", async () => {
    const render = vi.fn();
    const loadConfig = vi.fn(async () => ({}));

    await runTuiCommand({ cwd: "/repo" }, { render, loadConfig, resolveWorkspacePath: async () => "/repo" });

    expect(loadConfig).toHaveBeenCalledWith("/repo");
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: "/repo" }));
  });

  it("creates a default workspace config file on startup", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-tui-config-"));
    const render = vi.fn();

    try {
      await runTuiCommand({ cwd: workspace }, { render });

      const raw = await readFile(join(workspace, ".potato", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({});
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("disables Ink's default Ctrl+C exit so running tasks can cancel in-place", async () => {
    const renderInk = vi.fn();

    await runTuiCommand(
      { cwd: "/repo" },
      {
        renderInk,
        loadConfig: async () => ({}),
        resolveWorkspacePath: async () => "/repo"
      }
    );

    expect(renderInk).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ exitOnCtrlC: false }));
  });
});
