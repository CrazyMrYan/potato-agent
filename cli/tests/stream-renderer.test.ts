import { describe, expect, it } from "vitest";
import { EventStreamRenderer } from "../src/ui/EventStreamRenderer.js";
import pc from "picocolors";

describe("EventStreamRenderer", () => {
  it("streams assistant text deltas immediately while still rendering the final markdown block", () => {
    const renderer = new EventStreamRenderer({ colors: false, streamText: true });

    expect(renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "text", text: "我是" })).toBe("我是");
    expect(renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "text", text: " Potato" })).toBe(" Potato");
    expect(renderer.renderEvent({ type: "task.finished", taskId: "task_1", summary: "我是 Potato" })).toEqual([
      { kind: "text", text: "我是 Potato", replacePrevious: true }
    ]);
  });

  it("renders thinking deltas as running detail events when detail output is enabled", () => {
    const renderer = new EventStreamRenderer({ colors: false, streamDetails: true });

    expect(renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "thinking", text: "checking" })).toBe("checking");
  });

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

    expect(lines).toEqual(["Pi 开始新一轮推理", "The user", "read 读取文件：src/index.ts", "项目概览", "这是模型最终输出"]);
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

  it("renders markdown blocks in assistant text without touching tool output", () => {
    const renderer = new EventStreamRenderer({ colors: false });

    renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "text", text: "## Plan\n\n- test\n\n```ts\nconst x = 1;\n```" });
    const output = renderer.flush();

    expect(output).toContain("Plan");
    expect(output).not.toContain("## Plan");
    expect(output).toContain("* test");
    expect(output).toContain("const x = 1;");
  });

  it("renders markdown tables through a terminal markdown renderer", () => {
    const renderer = new EventStreamRenderer({ colors: false });

    renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "text", text: "| Name | Status |\n| --- | --- |\n| ctx | ok |" });
    const output = renderer.flush();

    expect(output).toContain("Name");
    expect(output).toContain("Status");
    expect(output).toContain("ctx");
    expect(output).toContain("ok");
    expect(output).not.toContain("| --- | --- |");
  });

  it("renders markdown tables from final task summaries", () => {
    const renderer = new EventStreamRenderer({ colors: false });
    const output = renderer.render({
      type: "task.finished",
      taskId: "task_1",
      summary: "### 5. Core 层独有依赖\n| 依赖 | 用途 |\n|------|------|\n| `gpt-tokenizer` | Token 计数/分词 |\n\n**总结**：项目最核心的依赖是 **`@earendil-works/pi-coding-agent`**"
    });

    expect(output).toContain("5. Core 层独有依赖");
    expect(output).toContain("gpt-tokenizer");
    expect(output).toContain("Token 计数/分词");
    expect(output).not.toContain("|------|------|");
    expect(output).toContain("@earendil-works/pi-coding-agent");
  });

  it("does not render task finished summary again when it duplicates streamed assistant text", () => {
    const renderer = new EventStreamRenderer({ colors: false });
    const streamed = [
      renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "text", text: "你好！我是\nPotato" }),
      renderer.render({ type: "task.finished", taskId: "task_1", summary: "你好！我是\nPotato" })
    ].filter(Boolean);

    expect(streamed).toEqual(["你好！我是\nPotato"]);
  });

  it("renders bold text inside ordered lists without raw markdown markers", () => {
    const renderer = new EventStreamRenderer({ colors: false });

    renderer.render({ type: "assistant.delta", taskId: "task_1", channel: "text", text: "1. **重点**：完成测试\n2. **验证**：运行构建" });
    const output = renderer.flush();

    expect(output).toContain("重点");
    expect(output).toContain("验证");
    expect(output).not.toContain("**重点**");
    expect(output).not.toContain("**验证**");
  });

  it("renders context budget and compaction status", () => {
    const renderer = new EventStreamRenderer({ colors: false });

    expect(
      renderer.render({
        type: "context.budget",
        taskId: "task_1",
        usedTokens: 820,
        maxTokens: 1000,
        ratio: 0.82,
        compactAtRatio: 0.75
      })
    ).toBe("context ◉◉◉◉◉◉◉◉○○ 82% · 820/1000 tokens · compact at 75%");
    expect(
      renderer.render({
        type: "context.compacted",
        taskId: "task_1",
        summary: "Goal: test",
        originalTokens: 820,
        compactedTokens: 120
      })
    ).toBe("context compacted 820 -> 120 tokens");
    expect(
      renderer.render({
        type: "context.compacted",
        taskId: "task_1",
        summary: "Nothing to compact (session too small).",
        originalTokens: 0,
        compactedTokens: 0
      })
    ).toBe("context compact skipped: Nothing to compact (session too small).");
  });

  it("renders todo updates and prompt cache hits in Chinese", () => {
    const renderer = new EventStreamRenderer({ colors: false });

    expect(
      renderer.render({
        type: "todo.updated",
        taskId: "task_1",
        todos: [
          { content: "写失败测试", status: "completed", activeForm: "正在写失败测试" },
          { content: "实现 Pi extension", status: "in_progress", activeForm: "正在实现 Pi extension" }
        ]
      } as never)
    ).toBe("todo 已更新：2 项 · 1 进行中 · 1 已完成");
    expect(
      renderer.render({
        type: "prompt.cache",
        taskId: "task_1",
        cachedTokens: 512,
        inputTokens: 1200
      } as never)
    ).toBe("缓存命中：512 tokens · 输入 1200 tokens");
  });

  it("colors diff lines by semantic kind instead of tinting the whole block uniformly", () => {
    const renderer = new EventStreamRenderer({ colors: true });
    const output = renderer.render({
      type: "diff.produced",
      taskId: "task_1",
      changeSet: {
        files: [
          {
            path: "src/a.ts",
            status: "modified",
            diff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new"
          }
        ]
      }
    });

    expect(output.split("\n")).toEqual([
      pc.magenta("diff: 1 file changed"),
      pc.blue("M modified src/a.ts"),
      pc.dim("  @@ -1 +1 @@"),
      pc.red("- old"),
      pc.green("+ new")
    ]);
  });
});
