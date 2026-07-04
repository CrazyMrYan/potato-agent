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
          return [{ taskId: "task_1", path: "/repo/.coding-agent/traces/task_1.jsonl", updatedAt: "2026-07-04T00:00:00.000Z", entries: 3 }];
        },
        async read() {
          return [];
        },
        async append() {}
      }
    });

    expect(write).toHaveBeenCalledWith("task_1 3 entries 2026-07-04T00:00:00.000Z");
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
});
