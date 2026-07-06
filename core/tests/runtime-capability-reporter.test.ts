import { describe, expect, it } from "vitest";
import { RuntimeCapabilityReporter } from "../src/runtime/RuntimeCapabilityReporter.js";

describe("RuntimeCapabilityReporter", () => {
  it("reports RPC capabilities without claiming tool interception", () => {
    expect(new RuntimeCapabilityReporter().forAdapter("rpc")).toEqual({
      adapter: "rpc",
      systemPrompt: true,
      skills: true,
      mcpServers: false,
      network: "unknown",
      toolAllowDeny: true,
      toolInterception: false,
      toolBoundaryApproval: false,
      notes: expect.arrayContaining([expect.stringContaining("Pi RPC")])
    });
  });

  it("reports runtime path as experimental until backed by an implementation", () => {
    expect(new RuntimeCapabilityReporter().forAdapter("runtime")).toEqual({
      adapter: "runtime",
      systemPrompt: true,
      skills: true,
      mcpServers: true,
      network: "supported",
      toolAllowDeny: true,
      toolInterception: true,
      toolBoundaryApproval: true,
      notes: expect.arrayContaining([expect.stringContaining("Vercel AI SDK"), expect.stringContaining("MCP SDK")])
    });
  });

  it("reports SDK path as the standard MCP injection target", () => {
    expect(new RuntimeCapabilityReporter().forAdapter("sdk")).toEqual({
      adapter: "sdk",
      systemPrompt: true,
      skills: true,
      mcpServers: true,
      network: "supported",
      toolAllowDeny: true,
      toolInterception: true,
      toolBoundaryApproval: true,
      notes: expect.arrayContaining([expect.stringContaining("Model Context Protocol")])
    });
  });
});
