import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_PERMISSION_POLICY } from "../src/config/AgentConfig.js";
import { ToolBoundary } from "../src/tools/ToolBoundary.js";

describe("ToolBoundary", () => {
  it("allows read tools from the default policy", async () => {
    const boundary = new ToolBoundary(DEFAULT_AGENT_PERMISSION_POLICY);
    await expect(boundary.decide({ tool: "read", summary: "read README.md" })).resolves.toEqual({ decision: "allow" });
  });

  it("requires confirmation for bash from the default policy", async () => {
    const boundary = new ToolBoundary(DEFAULT_AGENT_PERMISSION_POLICY);
    await expect(boundary.decide({ tool: "bash", summary: "pnpm test" })).resolves.toEqual({ decision: "confirm" });
  });

  it("denies tools in readonly mode unless they are allowed read tools", async () => {
    const boundary = new ToolBoundary({ mode: "readonly", allow: ["read"], confirm: [], deny: [] });
    await expect(boundary.decide({ tool: "bash", summary: "rm -rf dist" })).resolves.toEqual({
      decision: "deny",
      reason: "readonly mode blocks bash"
    });
  });

  it("uses approval callback for confirm decisions", async () => {
    const approve = vi.fn().mockResolvedValue(true);
    const boundary = new ToolBoundary(DEFAULT_AGENT_PERMISSION_POLICY, { approve });
    await expect(boundary.authorize({ tool: "bash", summary: "pnpm test" })).resolves.toEqual({ authorized: true });
    expect(approve).toHaveBeenCalledWith({ tool: "bash", summary: "pnpm test" });
  });
});
