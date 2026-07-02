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
    await runTuiCommand({ cwd: "/repo", provider: "deepseek", model: "deepseek-chat" }, { render });

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
});
