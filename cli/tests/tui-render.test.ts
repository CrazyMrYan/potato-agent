import React from "react";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { AgentTui, applyInlineSkillMentions, buildDiffEvents, buildRuntimeSessionConfig, filterCompletionCandidates, listWorkspaceFiles } from "../src/ui/AgentTui.js";

describe("AgentTui render", () => {
  it("maps slash diff output into semantic diff event kinds", () => {
    expect(
      buildDiffEvents({
        files: [
          {
            path: "src/a.ts",
            status: "modified",
            diff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new"
          }
        ]
      })
    ).toEqual([
      { kind: "diff", text: "diff: 1 file changed" },
      { kind: "diffFile", text: "M modified src/a.ts" },
      { kind: "diffHunk", text: "  @@ -1 +1 @@" },
      { kind: "diffRemove", text: "- old" },
      { kind: "diffAdd", text: "+ new" }
    ]);
  });

  it("renders a cleaner potato workspace instead of the old raw sections", () => {
    const { lastFrame } = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        }
      })
    );
    const frame = lastFrame() ?? "";

    expect(frame).not.toContain("█");
    expect(frame).toContain("│");
    expect(frame).toContain("┌");
    expect(frame).not.toContain("╭");
    expect(frame).not.toContain("╰");
    expect(frame).not.toContain("WORKSPACE");
    expect(frame).not.toContain("EVENTS");
    expect(frame).not.toContain("Agent status");
    expect(frame).not.toContain("status idle");
    expect(frame).not.toContain("model deepseek/deepseek-reasoner");
    expect(frame).not.toContain("mode manual");
    expect(frame).not.toContain("workspace /repo");
    expect(frame).not.toContain("commands /model");
    expect(frame).not.toContain("keys Ctrl+P");
    expect(frame).not.toContain("input");
  });

  it("keeps the final assistant answer visible instead of pushing it behind persistent status metadata", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "step.started" as const, taskId: "task_1", title: "开始处理任务" };
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "thinking" as const, text: "hidden reasoning" };
            for (let index = 0; index < 6; index++) {
              yield { type: "tool.started" as const, taskId: "task_1", tool: "find", summary: `查找 ${index}` };
              yield { type: "tool.finished" as const, taskId: "task_1", tool: "find", success: true, output: `output ${index}` };
            }
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: "最终答案：12 个 Markdown 文档" };
            yield { type: "task.finished" as const, taskId: "task_1", summary: "最终答案：12 个 Markdown 文档" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("count markdown");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "最终答案：12 个 Markdown 文档");
    const frame = rendered.lastFrame() ?? "";

    expect(frame).toContain("最终答案：12 个 Markdown 文档");
    expect(frame.indexOf("最终答案：12 个 Markdown 文档")).toBeGreaterThan(frame.indexOf("Tool output collapsed"));
    expect(frame).not.toContain("workspace ");
    expect(frame).not.toContain("commands /model");
    expect(frame).not.toContain("keys Ctrl+P");
  });

  it("hides thinking by default and toggles it with t", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "thinking" as const, text: "hidden reasoning" };
            yield { type: "task.finished" as const, taskId: "task_1", summary: "done" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "done");
    expect(rendered.lastFrame()).not.toContain("hidden reasoning");

    rendered.stdin.write("\u0014");
    await waitForFrames(rendered.frames, "hidden reasoning");
    expect(rendered.frames.join("\n")).toContain("hidden reasoning");
  });

  it("/details reveals thinking that arrived before the toggle while a task is still running", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    let releaseFinish: (() => void) | undefined;
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "thinking" as const, text: "thinking before toggle" };
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: "answering" };
            await new Promise<void>((resolve) => {
              releaseFinish = resolve;
            });
            yield { type: "task.finished" as const, taskId: "task_1", summary: "answering" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "状态：运行中");
    await waitForFrame(rendered.lastFrame, "Thinking collapsed");
    expect(rendered.lastFrame()).not.toContain("thinking before toggle");

    rendered.stdin.write("/details");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrames(rendered.frames, "thinking before toggle");

    await waitForCondition(() => releaseFinish !== undefined, "session to reach finish gate");
    releaseFinish?.();
    await waitForFrame(rendered.lastFrame, "状态：空闲");
  });

  it("shows assistant text when the task finishes", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    let releaseFinish: (() => void) | undefined;
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: "streaming now" };
            await new Promise<void>((resolve) => {
              releaseFinish = resolve;
            });
            yield { type: "task.finished" as const, taskId: "task_1", summary: "streaming now" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "状态：运行中");
    expect(rendered.lastFrame()).not.toContain("streaming now");

    await waitForCondition(() => releaseFinish !== undefined, "session to reach finish gate");
    releaseFinish?.();
    await waitForFrame(rendered.lastFrame, "streaming now");
    await waitForFrame(rendered.lastFrame, "状态：空闲");
  });

  it("coalesces streamed assistant deltas into one transcript line", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    let releaseFinish: (() => void) | undefined;
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: "当前" };
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: "有哪些" };
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: "skill" };
            await new Promise<void>((resolve) => {
              releaseFinish = resolve;
            });
            yield { type: "task.finished" as const, taskId: "task_1", summary: "当前有哪些skill" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForCondition(() => releaseFinish !== undefined, "session to reach finish gate");
    releaseFinish?.();
    await waitForFrame(rendered.lastFrame, "当前有哪些skill");
    const frame = rendered.lastFrame() ?? "";
    expect(frame).toContain("当前有哪些skill");
    expect(frame).not.toContain("当前\n  有哪些\n  skill");
    await waitForFrame(rendered.lastFrame, "状态：空闲");
  });

  it("replaces streamed raw markdown with the final rendered markdown instead of duplicating it", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: "## 项目" };
            yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: "说明" };
            yield { type: "task.finished" as const, taskId: "task_1", summary: "## 项目说明" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "项目说明");
    const frame = rendered.lastFrame() ?? "";

    expect(frame).toContain("项目说明");
    expect(frame).not.toContain("## 项目说明");
    expect(frame).not.toContain("## 项目说明项目说明");
    expect(frame.match(/项目说明/g)?.length).toBe(1);
  });

  it("pins context budget above the prompt instead of adding it to transcript", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "context.budget" as const, taskId: "task_1", usedTokens: 820, maxTokens: 1000, ratio: 0.82, compactAtRatio: 0.75 };
            yield { type: "task.finished" as const, taskId: "task_1", summary: "done" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "done");
    const frame = rendered.lastFrame() ?? "";

    expect(frame).toContain("context ◉◉◉◉◉◉◉◉○○ 82%");
    expect(frame).toContain("820/1000 tokens");
    expect(frame).toContain("compact at 75%");
    expect(frame).not.toContain("context ◉◉◉◉◉◉◉◉○○ 82%\n  done");
  });

  it("shows one fixed Chinese agent status on the right side of the context line", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "context.budget" as const, taskId: "task_1", usedTokens: 820, maxTokens: 1000, ratio: 0.82, compactAtRatio: 0.75 };
            yield { type: "tool.started" as const, taskId: "task_1", tool: "bash", summary: "pnpm test" };
            yield { type: "task.finished" as const, taskId: "task_1", summary: "done" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "done");
    const frame = rendered.lastFrame() ?? "";
    const contextLine = frame.split("\n").find((line) => line.includes("context ◉◉◉◉◉◉◉◉○○ 82%")) ?? "";

    expect(contextLine).toContain("状态：空闲");
    expect(contextLine.indexOf("状态：空闲")).toBeGreaterThan(contextLine.indexOf("compact at 75%"));
    expect(frame).not.toContain("agent running");
    expect(frame).not.toContain("agent idle");
  });

  it("/details reveals todo item details for todo updates", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield {
              type: "todo.updated" as const,
              taskId: "task_1",
              todos: [
                { content: "写失败测试", status: "completed" as const },
                { content: "实现 Pi extension", status: "in_progress" as const },
                { content: "补真实 Pi 验证", status: "pending" as const }
              ]
            };
            yield { type: "task.finished" as const, taskId: "task_1", summary: "done" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "todo 已更新：3 项");
    expect(rendered.lastFrame()).not.toContain("✓ 写失败测试");

    rendered.stdin.write("/details");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "✓ 写失败测试");
    expect(rendered.lastFrame()).toContain("● 实现 Pi extension");
    expect(rendered.lastFrame()).toContain("○ 补真实 Pi 验证");
  });

  it("renders the full transcript without keyboard-controlled scroll paging", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            for (let index = 0; index < 30; index++) {
              yield { type: "step.started" as const, taskId: "task_1", title: `line-${index}` };
            }
            yield { type: "task.finished" as const, taskId: "task_1", summary: "done" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "done");
    const frame = rendered.lastFrame() ?? "";

    expect(frame).toContain("line-0");
    expect(frame).toContain("line-29");
    expect(frame).not.toContain("PageUp/PageDown");
    expect(frame).not.toMatch(/transcript · \d+-\d+\/\d+/);
  });

  it("commits buffered assistant text after completion so terminal scrollback sees the full answer", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    let releaseFinish: (() => void) | undefined;
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            for (let index = 0; index < 25; index++) {
              yield { type: "assistant.delta" as const, taskId: "task_1", channel: "text" as const, text: `stream-${index}\n` };
            }
            await new Promise<void>((resolve) => {
              releaseFinish = resolve;
            });
            yield { type: "task.finished" as const, taskId: "task_1", summary: "finished" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "状态：运行中");

    const beforeFinish = rendered.frames.join("\n");
    expect(beforeFinish).toContain("状态：运行中");
    expect(beforeFinish).not.toContain("stream-24");
    expect(rendered.lastFrame() ?? "").toContain("状态：运行中");

    await waitForCondition(() => releaseFinish !== undefined, "session to reach finish gate");
    releaseFinish?.();
    await waitForFrames(rendered.frames, "stream-24");
    const afterFinish = rendered.frames.join("\n");
    expect(afterFinish).toContain("stream-0");
    expect(afterFinish).toContain("stream-24");
    expect(afterFinish).not.toContain("╭");
    expect(afterFinish).not.toContain("╰");
    await waitForFrame(rendered.lastFrame, "状态：空闲");
    await waitForFrames(rendered.frames, "状态：空闲");
  });

  it("recalls previous prompts with up and down arrows", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send(prompt: string) {
            yield { type: "task.finished" as const, taskId: `task_${prompt}`, summary: `done ${prompt}` };
          },
          async approve() {}
        })
      })
    );

    for (const prompt of ["first", "second", "third"]) {
      rendered.stdin.write(prompt);
      await new Promise((resolve) => setTimeout(resolve, 0));
      rendered.stdin.write("\r");
      await waitForFrame(rendered.lastFrame, `done ${prompt}`);
      await waitForPrompt(rendered.lastFrame, "");
    }

    rendered.stdin.write("\u001b[A");
    await waitForPrompt(rendered.lastFrame, "third");
    rendered.stdin.write("\u001b[A");
    await waitForPrompt(rendered.lastFrame, "second");
    rendered.stdin.write("\u001b[A");
    await waitForPrompt(rendered.lastFrame, "first");
    rendered.stdin.write("\u001b[A");
    await waitForPrompt(rendered.lastFrame, "first");
    rendered.stdin.write("\u001b[B");
    await waitForPrompt(rendered.lastFrame, "second");
    rendered.stdin.write("\u001b[B");
    await waitForPrompt(rendered.lastFrame, "third");
    rendered.stdin.write("\u001b[B");
    await waitForPrompt(rendered.lastFrame, "");
  });

  it("hides tool calls by default and expands them with Ctrl+O", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield { type: "tool.started" as const, taskId: "task_1", tool: "read", summary: "读取文件：README.md" };
            yield { type: "tool.finished" as const, taskId: "task_1", tool: "read", success: true, output: "file output" };
            yield { type: "task.finished" as const, taskId: "task_1", summary: "done" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "done");
    expect(rendered.lastFrame()).not.toContain("读取文件：README.md");
    expect(rendered.lastFrame()).not.toContain("file output");

    rendered.stdin.write("\u000f");
    await waitForFrames(rendered.frames, "读取文件：README.md");
    expect(rendered.frames.join("\n")).toContain("file output");
  });

  it("does not duplicate the slash while command completion is open", async () => {
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        }
      })
    );

    rendered.stdin.write("/");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = rendered.lastFrame() ?? "";

    expect(frame).toContain("COMMANDS");
    expect(frame).not.toContain("/ /");
  });

  it("executes a fuzzy matched slash command and opens its secondary menu", async () => {
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        }
      })
    );

    rendered.stdin.write("/mode");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = rendered.lastFrame() ?? "";

    expect(frame).toContain("MODE");
    expect(frame).toContain("manual");
    expect(frame).not.toContain("COMMANDS");
  });

  it("runs manual compaction from /compact", async () => {
    const compactContext = vi.fn(async function* () {
      yield { type: "context.budget" as const, taskId: "manual_compact", usedTokens: 20, maxTokens: 100, ratio: 0.2, compactAtRatio: 0.75 };
      yield { type: "context.compacted" as const, taskId: "manual_compact", summary: "Manual summary", originalTokens: 20, compactedTokens: 4 };
    });
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: {
          async list() {
            return [];
          },
          async install() {
            throw new Error("not used");
          },
          async setEnabled() {}
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {},
          async approve() {},
          compactContext
        })
      })
    );

    rendered.stdin.write("/compact");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "context compacted 20 -> 4 tokens");

    expect(compactContext).toHaveBeenCalledWith("manual");
  });

  it("/compact shows skipped native compaction without the old heuristic wording", async () => {
    const compactContext = vi.fn(async function* () {
      yield {
        type: "context.compacted" as const,
        taskId: "manual_compact",
        summary: "Nothing to compact (session too small).",
        originalTokens: 0,
        compactedTokens: 0
      };
    });
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: {
          async list() {
            return [];
          },
          async install() {
            throw new Error("not used");
          },
          async setEnabled() {}
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {},
          async approve() {},
          compactContext
        })
      })
    );

    rendered.stdin.write("/compact");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "context compact skipped: Nothing to compact (session too small).");
    const frame = rendered.lastFrame() ?? "";

    expect(frame).not.toContain("UNKNOWN_ERROR");
    expect(frame).not.toContain("heuristic summary");
  });

  it("/compact treats session-too-small failures as skipped compaction", async () => {
    const compactContext = vi.fn(async function* () {
      yield {
        type: "task.failed" as const,
        taskId: "manual_compact",
        error: {
          code: "UNKNOWN_ERROR" as const,
          message: "Nothing to compact (session too small)"
        }
      };
    });
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: {
          async list() {
            return [];
          },
          async install() {
            throw new Error("not used");
          },
          async setEnabled() {}
        },
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {},
          async approve() {},
          compactContext
        })
      })
    );

    rendered.stdin.write("/compact");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "context compact skipped: Nothing to compact (session too small).");
    const frame = rendered.lastFrame() ?? "";

    expect(frame).not.toContain("UNKNOWN_ERROR");
  });

  it("opens plan mode from /plan without sending it to the model", async () => {
    const send = vi.fn(async function* () {});
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: emptySkillManager(),
        createSession: () => ({
          async start() {},
          async stop() {},
          send,
          async approve() {}
        })
      })
    );

    rendered.stdin.write("/plan");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "PLAN MODE");
    expect(rendered.lastFrame()).not.toContain("当前模式只用于规划");
    expect(rendered.lastFrame()).not.toContain("输入“确认执行”");

    expect(send).not.toHaveBeenCalled();
  });

  it("keeps editing enabled in plan mode and sends planning-only prompts", async () => {
    const send = vi.fn(async function* () {
      yield { type: "task.finished" as const, taskId: "task_1", summary: "计划写好了，是否执行？" };
    });
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: emptySkillManager(),
        createSession: () => ({
          async start() {},
          async stop() {},
          send,
          async approve() {}
        })
      })
    );

    rendered.stdin.write("/plan");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "PLAN MODE");

    rendered.stdin.write("重构登录流程");
    await waitForPrompt(rendered.lastFrame, "重构登录流程");
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "计划写好了，是否执行？");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("当前处于计划模式");
    expect(send.mock.calls[0][0]).toContain("不要修改文件或执行开发");
    expect(send.mock.calls[0][0]).toContain("用户请求：重构登录流程");
    expect(rendered.lastFrame()).toContain("PLAN MODE");
    expect(rendered.lastFrame()).toContain("重构登录流程");
    expect(rendered.lastFrame()).not.toContain("当前处于计划模式");
    expect(rendered.lastFrame()).not.toContain("当前模式只用于规划");
    expect(rendered.lastFrame()).not.toContain("输入“确认执行”");
    expect(planModeLineIndex(rendered.lastFrame() ?? "")).toBeGreaterThan(promptBoxLineIndex(rendered.lastFrame() ?? ""));
  });

  it("stays in plan mode for adjustments and exits only when execution is confirmed", async () => {
    const prompts: string[] = [];
    const send = vi.fn(async function* (prompt: string) {
      prompts.push(prompt);
      yield { type: "task.finished" as const, taskId: `task_${prompts.length}`, summary: `done ${prompts.length}` };
    });
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: emptySkillManager(),
        createSession: () => ({
          async start() {},
          async stop() {},
          send,
          async approve() {}
        })
      })
    );

    rendered.stdin.write("/plan");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "PLAN MODE");

    rendered.stdin.write("继续调整错误处理");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "done 1");
    expect(rendered.lastFrame()).toContain("PLAN MODE");

    rendered.stdin.write("确认执行");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "done 2");

    expect(prompts[0]).toContain("继续调整错误处理");
    expect(prompts[0]).toContain("不要修改文件或执行开发");
    expect(prompts[1]).toContain("用户已确认执行");
    expect(prompts[1]).toContain("开始开发");
    expect(rendered.lastFrame()).not.toContain("当前模式只用于规划");
  });

  it("shows a loading status while the agent is running", async () => {
    let releaseFinish: (() => void) | undefined;
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: emptySkillManager(),
        createSession: () => ({
          async start() {},
          async stop() {},
          async *send() {
            await new Promise<void>((resolve) => {
              releaseFinish = resolve;
            });
            yield { type: "task.finished" as const, taskId: "task_1", summary: "done" };
          },
          async approve() {}
        })
      })
    );

    rendered.stdin.write("task");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "状态：运行中.");

    await waitForCondition(() => releaseFinish !== undefined, "session to reach finish gate");
    releaseFinish?.();
    await waitForFrame(rendered.lastFrame, "状态：空闲");
  });

  it("lists workspace files for @ completion", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    await writeFile(join(workspacePath, "README.md"), "# test\n");
    await writeFile(join(workspacePath, "package.json"), "{}\n");
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        }
      })
    );

    rendered.stdin.write("@");
    await waitForFrame(rendered.lastFrame, "README.md");
    const frame = rendered.lastFrame() ?? "";

    expect(frame).toContain("FILES");
    expect(frame).toContain("README.md");
  });

  it("fuzzy matches package.json for @package completion", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    await writeFile(join(workspacePath, "package.json"), "{}\n");
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath,
          provider: "deepseek",
          model: "deepseek-reasoner"
        }
      })
    );

    rendered.stdin.write("@package");
    await waitForFrame(rendered.lastFrame, "package.json");
    const frame = rendered.lastFrame() ?? "";

    expect(frame).toContain("FILES");
    expect(frame).toContain('query "package"');
    expect(frame).toContain("package.json");
    expect(frame).not.toContain("no matches");
  });

  it("lists package.json from a workspace and matches package queries", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    await writeFile(join(workspacePath, "package.json"), "{}\n");
    await writeFile(join(workspacePath, "pnpm-workspace.yaml"), "packages: []\n");

    const files = await listWorkspaceFiles(workspacePath);

    expect(files).toContain("package.json");
    expect(filterCompletionCandidates(files, "package", 12)).toContain("package.json");
  });

  it("falls back to Node filesystem scanning when external file commands are unavailable", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
    await writeFile(join(workspacePath, "package.json"), "{}\n");
    const previousPath = process.env.PATH;
    process.env.PATH = "";

    try {
      const files = await listWorkspaceFiles(workspacePath);

      expect(files).toContain("package.json");
    } finally {
      process.env.PATH = previousPath;
    }
  });

  it("renders mode, skill, mcp, and potato command entries in the slash menu", async () => {
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: {
          async list() {
            return [{ id: "systematic-debugging", name: "systematic-debugging", path: "builtin:systematic-debugging", source: "builtin", enabled: true }];
          },
          async install() {
            throw new Error("not used");
          },
          async setEnabled() {}
        }
      })
    );

    rendered.stdin.write("/");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rendered.lastFrame()).toContain("/mode");
    expect(rendered.lastFrame()).toContain("/skill");
    expect(rendered.lastFrame()).toContain("/mcp");
    expect(rendered.lastFrame()).toContain("/agent");
  });

  it("pauses the active task when approval is rejected with n", async () => {
    const rejectAndPause = vi.fn(async () => {});
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        skillManager: {
          async list() {
            return [];
          },
          async install() {
            throw new Error("not used");
          },
          async setEnabled() {}
        },
        createSession: async () => ({
          async start() {},
          async stop() {},
          async *send() {
            yield {
              type: "approval.requested",
              taskId: "turn_1",
              request: {
                id: "approval_1",
                taskId: "turn_1",
                kind: "write_file",
                title: "Approve write?",
                detail: "File: package.json\n--- a/package.json\n+++ b/package.json\n-old\n+new",
                risk: "medium"
              }
            };
          },
          async approve() {},
          rejectAndPause
        })
      })
    );

    rendered.stdin.write("change package");
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered.stdin.write("\r");
    await waitForFrame(rendered.lastFrame, "APPROVAL REQUIRED");
    rendered.stdin.write("n");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = rendered.lastFrame() ?? "";

    expect(rejectAndPause).toHaveBeenCalledWith("approval_1");
    expect(frame).toContain("已暂停：Approve write?");
  });

  it("builds runtime session config with the current SkillManager list", async () => {
    await expect(
      buildRuntimeSessionConfig(
        {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
        {
          async list() {
            return [
              { id: "systematic-debugging", name: "systematic-debugging", path: "/repo/.potato/skills/.builtin/systematic-debugging", source: "builtin", enabled: true },
              { id: "skill-creator", name: "skill-creator", path: "/repo/.potato/skills/.builtin/skill-creator", source: "builtin", enabled: false }
            ];
          }
        }
      )
    ).resolves.toMatchObject({
      workspacePath: "/repo",
      skills: [
        { id: "systematic-debugging", name: "systematic-debugging", path: "/repo/.potato/skills/.builtin/systematic-debugging", source: "builtin", enabled: true },
        { id: "skill-creator", name: "skill-creator", path: "/repo/.potato/skills/.builtin/skill-creator", source: "builtin", enabled: false }
      ]
    });
  });

  it("builds runtime session config with the active subagent applied", async () => {
    await expect(
      buildRuntimeSessionConfig(
        {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner",
          activeSubAgentId: "code-reviewer"
        },
        {
          async list() {
            return [];
          }
        },
        {
          async applyActive(config) {
            return {
              ...config,
              appendSystemPrompt: ["SubAgent: Code Reviewer"],
              permissionPolicy: { mode: "readonly" }
            };
          }
        }
      )
    ).resolves.toMatchObject({
      activeSubAgentId: "code-reviewer",
      appendSystemPrompt: ["SubAgent: Code Reviewer"],
      permissionPolicy: { mode: "readonly" }
    });
  });

  it("enables inline mentioned skills for the current turn", () => {
    expect(
      applyInlineSkillMentions(
        {
          skills: [
            { id: "systematic-debugging", name: "systematic-debugging", path: "/skills/debug", source: "builtin", enabled: false },
            { id: "skill-creator", name: "skill-creator", path: "/skills/create", source: "builtin", enabled: false }
          ]
        },
        "use $systematic-debugging"
      )
    ).toMatchObject({
      skills: [
        { id: "systematic-debugging", enabled: true },
        { id: "skill-creator", enabled: false }
      ],
      appendSystemPrompt: ["Inline skills for this turn: systematic-debugging"]
    });
  });
});

function emptySkillManager() {
  return {
    async list() {
      return [];
    },
    async install() {
      throw new Error("not used");
    },
    async setEnabled() {}
  };
}

async function waitForFrame(lastFrame: () => string | undefined, text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((lastFrame() ?? "").includes(text)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${text}.\n${lastFrame() ?? ""}`);
}

async function waitForPrompt(lastFrame: () => string | undefined, text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const prompt = currentPromptText(lastFrame() ?? "");
    if (prompt === text) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for prompt ${JSON.stringify(text)}.\n${lastFrame() ?? ""}`);
}

async function waitForFrames(frames: string[], text: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (frames.join("\n").includes(text)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${text}.\n${frames.join("\n")}`);
}

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function currentPromptText(frame: string): string {
  const matches = [...frame.matchAll(/│ ([^│]*?)▌\s*│/g)];
  const value = matches.at(-1)?.[1] ?? "";
  return value.trimEnd();
}

function promptBoxLineIndex(frame: string): number {
  return frame.split("\n").findIndex((line) => line.includes("└") && line.includes("┘"));
}

function planModeLineIndex(frame: string): number {
  return frame.split("\n").findIndex((line) => line.includes("PLAN MODE"));
}
