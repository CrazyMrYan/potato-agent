import { describe, expect, it, vi } from "vitest";
import type { PiAdapter } from "@potato/core";
import { createAdapter, runCommand, type RunCommandOptions } from "../src/commands/run.js";

describe("run command model configuration", () => {
  it("uses PiRpcAdapter by default", () => {
    const adapter = createAdapter({
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: "test-key",
      workspacePath: "/repo"
    });

    expect(adapter.constructor.name).toBe("PiRpcAdapter");
  });

  it("requires provider and model for Pi adapter", () => {
    expect(() => createAdapter({ workspacePath: "/repo" })).toThrow(/--provider/);
    expect(() => createAdapter({ provider: "openai", workspacePath: "/repo" })).toThrow(/--model/);
  });

  it("requires an API key for Pi adapter", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      expect(() =>
        createAdapter({ provider: "openai", model: "gpt-5.5", workspacePath: "/repo" })
      ).toThrow(/OPENAI_API_KEY/);
    } finally {
      if (previous) {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("accepts a runtime API key for Pi adapter", () => {
    const adapter = createAdapter({
      provider: "openai",
      model: "gpt-5.5",
      apiKey: "test-key",
      workspacePath: "/repo"
    });

    expect(adapter.constructor.name).toBe("PiRpcAdapter");
  });

  it("uses provider-specific environment variables for Pi adapter", () => {
    const previous = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "test-google-key";

    try {
      const adapter = createAdapter({
        provider: "gemini",
        model: "gemini-2.5-pro",
        workspacePath: "/repo"
      });

      expect(adapter.constructor.name).toBe("PiRpcAdapter");
    } finally {
      if (previous) {
        process.env.GOOGLE_API_KEY = previous;
      } else {
        delete process.env.GOOGLE_API_KEY;
      }
    }
  });

  it("uses DEEPSEEK_API_KEY for DeepSeek provider", () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";

    try {
      const adapter = createAdapter({
        provider: "deepseek",
        model: "deepseek-chat",
        workspacePath: "/repo"
      });

      expect(adapter.constructor.name).toBe("PiRpcAdapter");
    } finally {
      if (previous) {
        process.env.DEEPSEEK_API_KEY = previous;
      } else {
        delete process.env.DEEPSEEK_API_KEY;
      }
    }
  });

  it("passes configured workspace to task input", async () => {
    const seen = [];
    const adapter: PiAdapter = {
      async *run(input) {
        seen.push(input);
        yield { type: "task.finished", taskId: input.taskId, summary: "done" };
      }
    };
    const options: RunCommandOptions = {
      workspacePath: "/tmp/example",
      createAdapter: () => adapter,
      write: vi.fn()
    };

    await runCommand("解释项目", options);

    expect(seen[0]?.workspacePath).toBe("/tmp/example");
  });

  it("resolves workspace root when workspace is not explicitly configured", async () => {
    const seen = [];
    const adapter: PiAdapter = {
      async *run(input) {
        seen.push(input);
        yield { type: "task.finished", taskId: input.taskId, summary: "done" };
      }
    };

    await runCommand("解释项目", {
      cwd: "/repo/cli",
      resolveWorkspacePath: async () => "/repo",
      createAdapter: () => adapter,
      createTraceStore: () => ({
        async append() {},
        async read() {
          return [];
        },
        async list() {
          return [];
        }
      }),
      createDiffService: () => ({
        async getChangeSet() {
          return { files: [] };
        }
      }),
      write: vi.fn()
    });

    expect(seen[0]?.workspacePath).toBe("/repo");
  });

  it("fails the command when the potato emits task.failed", async () => {
    const adapter: PiAdapter = {
      async *run(input) {
        yield {
          type: "task.failed",
          taskId: input.taskId,
          error: { code: "PI_INIT_FAILED", message: "Pi 启动失败" }
        };
      }
    };

    await expect(
      runCommand("解释项目", {
        workspacePath: "/tmp/example",
        createAdapter: () => adapter,
        write: vi.fn()
      })
    ).rejects.toThrow(/PI_INIT_FAILED Pi 启动失败/);
  });

  it("wires trace store and diff service into orchestrator", async () => {
    const writes: string[] = [];
    const adapter: PiAdapter = {
      async *run(input) {
        yield { type: "task.finished", taskId: input.taskId, summary: "done" };
      }
    };

    await runCommand("解释项目", {
      workspacePath: "/tmp/example",
      createAdapter: () => adapter,
      createTraceStore: () => ({
        async append() {},
        async read() {
          return [];
        },
        async list() {
          return [];
        }
      }),
      createDiffService: () => ({
        async getChangeSet() {
          return { files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] };
        }
      }),
      write: (line) => writes.push(line)
    });

    expect(writes.join("\n")).toContain("diff 1 个文件");
  });
});
