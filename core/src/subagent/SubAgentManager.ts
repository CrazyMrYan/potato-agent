import type { AgentConfig, AgentSkillConfig } from "../config/AgentConfig.js";
import { type AgentConfigStore, FileAgentConfigStore } from "../config/AgentConfigStore.js";
import type { SubAgentConfig } from "./SubAgentConfig.js";
import { mergeSubAgentConfig } from "./SubAgentConfig.js";

export const DEFAULT_SUB_AGENTS: SubAgentConfig[] = [
  {
    id: "default",
    name: "Default Agent",
    description: "Use the main coding agent without a specialized role.",
    enabled: true
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "Read code, identify correctness risks, and report findings before changes.",
    systemPrompt: "Act as a code review subagent. Prioritize bugs, regressions, missing tests, and concrete file references.",
    tools: { allow: ["read", "ls", "grep", "find"] },
    permissionPolicy: { mode: "readonly" },
    skills: [
      { id: "requesting-code-review", name: "requesting-code-review", path: "builtin:requesting-code-review", source: "builtin", enabled: true },
      { id: "receiving-code-review", name: "receiving-code-review", path: "builtin:receiving-code-review", source: "builtin", enabled: true }
    ],
    enabled: true
  },
  {
    id: "debugger",
    name: "Debugger",
    description: "Investigate failures systematically and verify root cause before fixing.",
    systemPrompt: "Act as a debugging subagent. Reproduce the failure, isolate root cause, then propose or apply the smallest verified fix.",
    tools: { allow: ["read", "ls", "grep", "find", "bash"] },
    permissionPolicy: { mode: "confirm", confirm: ["bash", "edit", "write"] },
    skills: [{ id: "systematic-debugging", name: "systematic-debugging", path: "builtin:systematic-debugging", source: "builtin", enabled: true }],
    enabled: true
  }
];

export class SubAgentManager {
  constructor(
    private readonly configStore: AgentConfigStore = new FileAgentConfigStore(process.cwd())
  ) {}

  async list(): Promise<SubAgentConfig[]> {
    const config = await this.configStore.load();
    const configured = config.subAgents ?? [];
    const byId = new Map(DEFAULT_SUB_AGENTS.map((agent) => [agent.id, agent]));

    for (const agent of configured) {
      const base = byId.get(agent.id);
      byId.set(agent.id, base ? mergeSubAgentConfig(base, agent) : agent);
    }

    return [...byId.values()];
  }

  async select(id: string): Promise<SubAgentConfig> {
    const agents = await this.list();
    const selected = agents.find((agent) => agent.id === id && agent.enabled !== false);
    if (!selected) {
      throw new Error(`SubAgent not found or disabled: ${id}`);
    }

    const config = await this.configStore.load();
    await this.configStore.save({ ...config, subAgents: agents, activeSubAgentId: id });
    return selected;
  }

  async applyActive(config: AgentConfig): Promise<AgentConfig> {
    const stored = await this.configStore.load();
    const activeId = config.activeSubAgentId ?? stored.activeSubAgentId;
    if (!activeId || activeId === "default") {
      return { ...config, activeSubAgentId: activeId ?? "default", subAgents: await this.list() };
    }

    const agent = (await this.list()).find((item) => item.id === activeId && item.enabled !== false);
    if (!agent) {
      return { ...config, activeSubAgentId: "default", subAgents: await this.list() };
    }

    return {
      ...config,
      activeSubAgentId: agent.id,
      subAgents: await this.list(),
      appendSystemPrompt: [...(config.appendSystemPrompt ?? []), formatSubAgentPrompt(agent)],
      skills: mergeSkills(config.skills ?? [], agent.skills ?? []),
      tools: agent.tools ? { ...config.tools, ...agent.tools } : config.tools,
      permissionPolicy: agent.permissionPolicy ? { ...config.permissionPolicy, ...agent.permissionPolicy } : config.permissionPolicy
    };
  }
}

function formatSubAgentPrompt(agent: SubAgentConfig): string {
  return [`SubAgent: ${agent.name} (${agent.id})`, `Description: ${agent.description}`, agent.systemPrompt].filter(Boolean).join("\n");
}

function mergeSkills(base: AgentSkillConfig[], additions: AgentSkillConfig[]): AgentSkillConfig[] {
  const byId = new Map<string, AgentSkillConfig>();
  for (const skill of base) {
    byId.set(skill.id ?? skill.path, skill);
  }
  for (const skill of additions) {
    byId.set(skill.id ?? skill.path, skill);
  }
  return [...byId.values()];
}
