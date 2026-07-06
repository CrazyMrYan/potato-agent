import React from "react";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { AgentTui, applyInlineSkillMentions, buildRuntimeSessionConfig, filterCompletionCandidates, listWorkspaceFiles } from "../src/ui/AgentTui.js";

describe("AgentTui render", () => {
  it("renders a cleaner agent workspace instead of the old raw sections", () => {
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
    expect(frame).toContain("commands /model /workspace /diff /trace /mode /skill /mcp /agent /exit");
    expect(frame).not.toContain("input");
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
    await new Promise((resolve) => setTimeout(resolve, 50));
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
    await new Promise((resolve) => setTimeout(resolve, 50));
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

  it("renders mode, skill, mcp, and agent command entries", async () => {
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
              { id: "systematic-debugging", name: "systematic-debugging", path: "/repo/.coding-agent/skills/.builtin/systematic-debugging", source: "builtin", enabled: true },
              { id: "skill-creator", name: "skill-creator", path: "/repo/.coding-agent/skills/.builtin/skill-creator", source: "builtin", enabled: false }
            ];
          }
        }
      )
    ).resolves.toMatchObject({
      workspacePath: "/repo",
      skills: [
        { id: "systematic-debugging", name: "systematic-debugging", path: "/repo/.coding-agent/skills/.builtin/systematic-debugging", source: "builtin", enabled: true },
        { id: "skill-creator", name: "skill-creator", path: "/repo/.coding-agent/skills/.builtin/skill-creator", source: "builtin", enabled: false }
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
