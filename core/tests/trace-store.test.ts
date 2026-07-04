import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlTraceStore } from "../src/trace/JsonlTraceStore.js";

describe("JsonlTraceStore", () => {
  it("appends and reads task trace entries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-trace-"));
    try {
      const store = new JsonlTraceStore(workspace);

      await store.append({
        timestamp: "2026-07-04T00:00:00.000Z",
        taskId: "task_1",
        kind: "task.input",
        input: {
          taskId: "task_1",
          workspacePath: workspace,
          prompt: "explain",
          mode: "run",
          approvalMode: "manual"
        }
      });
      await store.append({
        timestamp: "2026-07-04T00:00:01.000Z",
        taskId: "task_1",
        kind: "task.finished",
        summary: "done"
      });

      await expect(store.read("task_1")).resolves.toEqual([
        expect.objectContaining({ kind: "task.input", taskId: "task_1" }),
        expect.objectContaining({ kind: "task.finished", taskId: "task_1", summary: "done" })
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("lists traces from newest to oldest", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-trace-list-"));
    try {
      const store = new JsonlTraceStore(workspace);
      await store.append({ timestamp: "2026-07-04T00:00:00.000Z", taskId: "task_old", kind: "task.finished", summary: "old" });
      await store.append({ timestamp: "2026-07-04T00:00:02.000Z", taskId: "task_new", kind: "task.finished", summary: "new" });

      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ taskId: "task_new" }),
        expect.objectContaining({ taskId: "task_old" })
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
