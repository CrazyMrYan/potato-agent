import { describe, expect, it } from "vitest";
import { mergeSubAgentConfig } from "../src/subagent/SubAgentConfig.js";

describe("SubAgentConfig", () => {
  it("merges subagent config with runtime overrides", () => {
    expect(
      mergeSubAgentConfig(
        {
          id: "reviewer",
          name: "Reviewer",
          description: "Review code",
          systemPrompt: "review carefully",
          skills: [{ id: "systematic-debugging", name: "systematic-debugging", path: "builtin:systematic-debugging", source: "builtin", enabled: true }],
          tools: { allow: ["read"] },
          permissionPolicy: { mode: "readonly" },
          enabled: true
        },
        {
          tools: { allow: ["read", "grep"] },
          permissionPolicy: { mode: "confirm", confirm: ["bash"] }
        }
      )
    ).toMatchObject({
      id: "reviewer",
      tools: { allow: ["read", "grep"] },
      permissionPolicy: { mode: "confirm", confirm: ["bash"] },
      enabled: true
    });
  });
});
