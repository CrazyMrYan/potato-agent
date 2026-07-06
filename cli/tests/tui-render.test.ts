import React from "react";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { AgentTui, applyInlineSkillMentions, buildRuntimeSessionConfig, filterCompletionCandidates, listWorkspaceFiles } from "../src/ui/AgentTui.js";

describe("AgentTui render", () => {
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
    expect(frame).toContain("╭");
    expect(frame).toContain("┌");
    expect(frame).not.toContain("WORKSPACE");
    expect(frame).not.toContain("EVENTS");
    expect(frame).toContain("Agent");
    expect(frame).toContain("status idle");
    expect(frame).toContain("model deepseek/deepseek-reasoner");
    expect(frame).toContain("workspace /repo");
    expect(frame).toContain("mode manual");
    expect(frame).toContain("subagent default");
    expect(frame).toContain("network unknown");
    expect(frame).toContain("commands /model /workspace /diff /trace /compact /plan /mode /skill /mcp /agent /exit");
    expect(frame).toContain("keys Ctrl+P F12 details Ctrl+C");
    expect(frame).not.toContain("input");
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
    await waitForFrame(rendered.lastFrame, "hidden reasoning");
    expect(rendered.lastFrame()).toContain("hidden reasoning");
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
    await waitForFrame(rendered.lastFrame, "读取文件：README.md");
    expect(rendered.lastFrame()).toContain("file output");
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

  it("opens plan mode from /plan without sending it to the model", async () => {
    const send = vi.fn(async function* () {});
    const rendered = render(
      React.createElement(AgentTui, {
        config: {
          workspacePath: "/repo",
          provider: "deepseek",
          model: "deepseek-reasoner"
        },
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

    expect(send).not.toHaveBeenCalled();
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

  it("renders mode, skill, mcp, and potato command entries", async () => {
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

function currentPromptText(frame: string): string {
  const matches = [...frame.matchAll(/│ ([^│]*?)▌\s*│/g)];
  const value = matches.at(-1)?.[1] ?? "";
  return value.trimEnd();
}
