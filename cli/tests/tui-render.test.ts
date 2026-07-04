import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { AgentTui } from "../src/ui/AgentTui.js";

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
    expect(frame).toContain("commands /model /workspace /diff /trace /mode /exit");
    expect(frame).toContain("input");
  });
});
