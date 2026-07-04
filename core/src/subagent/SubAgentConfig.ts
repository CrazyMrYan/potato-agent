import type { AgentPermissionPolicy, AgentSkillConfig, AgentToolConfig } from "../config/AgentConfig.js";

export type SubAgentConfig = {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  skills?: AgentSkillConfig[];
  tools?: AgentToolConfig;
  permissionPolicy?: AgentPermissionPolicy;
  enabled: boolean;
};

export type SubAgentConfigOverride = Partial<Omit<SubAgentConfig, "id" | "name" | "description" | "enabled">>;

export function mergeSubAgentConfig(base: SubAgentConfig, override: SubAgentConfigOverride): SubAgentConfig {
  return {
    ...base,
    ...override,
    tools: override.tools ? { ...base.tools, ...override.tools } : base.tools,
    permissionPolicy: override.permissionPolicy ? { ...base.permissionPolicy, ...override.permissionPolicy } : base.permissionPolicy,
    skills: override.skills ?? base.skills
  };
}
