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
      systemPrompt: false,
      skills: false,
      mcpServers: false,
      network: "unsupported",
      toolAllowDeny: false,
      toolInterception: false,
      toolBoundaryApproval: false,
      notes: expect.arrayContaining([expect.stringContaining("experimental")])
    });
  });
});
