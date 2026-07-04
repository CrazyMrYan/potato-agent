import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { AgentTui, buildRuntimeSessionConfig } from "../src/ui/AgentTui.js";

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
    expect(frame).toContain("commands /model /workspace /diff /trace /mode /skill /mcp /agent /exit");
    expect(frame).toContain("input");
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
              { id: "systematic-debugging", name: "systematic-debugging", path: "/repo/.coding-agent/builtin-skills/systematic-debugging", source: "builtin", enabled: true },
              { id: "skill-creator", name: "skill-creator", path: "/repo/.coding-agent/builtin-skills/skill-creator", source: "builtin", enabled: false }
            ];
          }
        }
      )
    ).resolves.toMatchObject({
      workspacePath: "/repo",
      skills: [
      { id: "systematic-debugging", name: "systematic-debugging", path: "/repo/.coding-agent/builtin-skills/systematic-debugging", source: "builtin", enabled: true },
      { id: "skill-creator", name: "skill-creator", path: "/repo/.coding-agent/builtin-skills/skill-creator", source: "builtin", enabled: false }
      ]
    });
  });
});
