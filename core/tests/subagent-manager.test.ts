import { describe, expect, it } from "vitest";
import { SubAgentManager } from "../src/subagent/SubAgentManager.js";
import type { AgentConfig } from "../src/config/AgentConfig.js";

describe("SubAgentManager", () => {
  it("lists default and configured subagents", async () => {
    const manager = new SubAgentManager(new MemoryConfigStore({}));

    await expect(manager.list()).resolves.toEqual([
      expect.objectContaining({ id: "default", enabled: true }),
      expect.objectContaining({ id: "code-reviewer", enabled: true }),
      expect.objectContaining({ id: "debugger", enabled: true })
    ]);
  });

  it("selects an active subagent and applies it to runtime config", async () => {
    const store = new MemoryConfigStore({});
    const manager = new SubAgentManager(store);

    await manager.select("code-reviewer");
    const runtime = await manager.applyActive({
      appendSystemPrompt: ["base"],
      skills: [{ id: "systematic-debugging", name: "systematic-debugging", path: "/skills/debug", source: "builtin", enabled: true }]
    });

    expect(store.saved?.activeSubAgentId).toBe("code-reviewer");
    expect(runtime.activeSubAgentId).toBe("code-reviewer");
    expect(runtime.appendSystemPrompt?.join("\n")).toContain("SubAgent: Code Reviewer");
    expect(runtime.tools).toEqual(expect.objectContaining({ allow: expect.arrayContaining(["read", "grep"]) }));
    expect(runtime.permissionPolicy).toEqual(expect.objectContaining({ mode: "readonly" }));
  });
});

class MemoryConfigStore {
  saved?: AgentConfig;

  constructor(private config: AgentConfig) {}

  async load(): Promise<AgentConfig> {
    return this.saved ?? this.config;
  }

  async save(config: AgentConfig): Promise<void> {
    this.saved = config;
  }
}
