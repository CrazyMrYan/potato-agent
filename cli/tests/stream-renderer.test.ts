import { describe, expect, it } from "vitest";
import { EventStreamRenderer } from "../src/ui/EventStreamRenderer.js";

describe("EventStreamRenderer", () => {
  it("renders potato events without hard-coded Chinese prefixes around model content", () => {
    const renderer = new EventStreamRenderer({ colors: false });
    const lines = [
      renderer.render({ type: "step.started", taskId: "task_1", title: "Pi 开始新一轮推理" }),
      renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "thinking", text: "The" }),
      renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "thinking", text: " user" }),
      renderer.render({ type: "tool.started", taskId: "task_1", tool: "read", summary: "读取文件：src/index.ts" }),
      renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "text", text: "## 项目" }),
      renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "text", text: "概览" }),
      renderer.render({ type: "task.finished", taskId: "task_1", summary: "这是模型最终输出" })
    ]
      .filter((line) => line.length > 0)
      .flatMap((line) => line.split("\n"));

    expect(lines).toEqual([
      "Pi 开始新一轮推理",
      "The user",
      "read 读取文件：src/index.ts",
      "## 项目概览",
      "这是模型最终输出"
    ]);
  });

  it("keeps long tool results compact", () => {
    const renderer = new EventStreamRenderer({ colors: false, maxToolOutputLength: 20 });
    const line = renderer.render({
      type: "tool.finished",
      taskId: "task_1",
      tool: "bash",
      success: true,
      output: "line one\nline two\nline three"
    });

    expect(line).toBe("bash line one line two...");
  });
});
