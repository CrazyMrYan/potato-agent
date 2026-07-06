import { describe, expect, it, vi } from "vitest";
import { traceCommand } from "../src/commands/trace.js";

describe("trace command", () => {
  it("lists traces when no task id is provided", async () => {
    const write = vi.fn();
    await traceCommand({
      workspacePath: "/repo",
      write,
      traceStore: {
        async list() {
          return [{ taskId: "task_1", path: "/repo/.potato/traces/task_1.jsonl", updatedAt: "2026-07-04T00:00:00.000Z", entries: 3 }];
        },
        async read() {
          return [];
        },
        async append() {}
      }
    });

    expect(write).toHaveBeenCalledWith("task_1 3 entries 2026-07-04T00:00:00.000Z");
    expect(write).toHaveBeenCalledWith("Use `potato trace latest` or `potato trace <taskId>` to inspect entries.");
  });

  it("resolves the default workspace before listing traces", async () => {
    const write = vi.fn();
    const seen: string[] = [];

    await traceCommand({
      cwd: "/repo/cli",
      write,
      resolveWorkspacePath: async (cwd) => {
        seen.push(cwd);
        return "/repo";
      },
      traceStoreFactory: (workspacePath) => ({
        async list() {
          seen.push(workspacePath);
          return [];
        },
        async read() {
          return [];
        },
        async append() {}
      })
    });

    expect(seen).toEqual(["/repo/cli", "/repo"]);
  });

  it("explains how traces are created when there are none", async () => {
    const write = vi.fn();

    await traceCommand({
      workspacePath: "/repo",
      write,
      traceStore: {
        async list() {
          return [];
        },
        async read() {
          return [];
        },
        async append() {}
      }
    });

    expect(write).toHaveBeenCalledWith("No traces yet. Run an potato task first with `potato run` or the TUI.");
  });

  it("prints raw trace entries for a task id", async () => {
    const write = vi.fn();
    await traceCommand({
      workspacePath: "/repo",
      taskId: "task_1",
      raw: true,
      write,
      traceStore: {
        async list() {
          return [];
        },
        async read() {
          return [{ timestamp: "2026-07-04T00:00:00.000Z", taskId: "task_1", kind: "task.finished", summary: "done" }];
        },
        async append() {}
      }
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining("\"kind\":\"task.finished\""));
  });

  it("prints readable latest trace entries", async () => {
    const write = vi.fn();
    await traceCommand({
      workspacePath: "/repo",
      taskId: "latest",
      write,
      traceStore: {
        async list() {
          return [{ taskId: "task_1", path: "/repo/.potato/traces/task_1.jsonl", updatedAt: "2026-07-04T00:00:00.000Z", entries: 4 }];
        },
        async read(taskId: string) {
          return [
            { timestamp: "2026-07-04T00:00:00.000Z", taskId, kind: "task.input", input: { taskId, workspacePath: "/repo", prompt: "review", mode: "run", approvalMode: "manual" } },
            { timestamp: "2026-07-04T00:00:01.000Z", taskId, kind: "event", event: { type: "subagent.selected", taskId, subAgentId: "code-reviewer", name: "Code Reviewer", description: "Review code" } },
            { timestamp: "2026-07-04T00:00:02.000Z", taskId, kind: "event", event: { type: "tool.started", taskId, tool: "read", summary: "读取文件：src/a.ts" } },
            { timestamp: "2026-07-04T00:00:03.000Z", taskId, kind: "task.finished", summary: "done" }
          ];
        },
        async append() {}
      }
    });

    expect(write).toHaveBeenCalledWith("trace task_1");
    expect(write).toHaveBeenCalledWith("2026-07-04T00:00:01.000Z subagent.selected Code Reviewer (code-reviewer)");
    expect(write).toHaveBeenCalledWith("2026-07-04T00:00:02.000Z tool.started read 读取文件：src/a.ts");
    expect(write).toHaveBeenCalledWith("2026-07-04T00:00:03.000Z task.finished done");
  });
});
