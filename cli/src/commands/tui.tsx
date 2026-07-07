import React from "react";
import { render as renderInk } from "ink";
import {
  AgentSessionFactory,
  ensureDefaultAgentConfig,
  FileAgentConfigStore,
  mergeAgentConfig,
  resolveDefaultWorkspacePath,
  SessionMetadataStore,
  type AgentConfig
} from "@potato/core";
import { AgentTui } from "../ui/AgentTui.js";

export type TuiCommandOptions = AgentConfig & {
  cwd?: string;
  resolvedWorkspacePath?: string;
};

export type TuiCommandDependencies = {
  render?: (config: AgentConfig) => void | Promise<void>;
  loadConfig?: (workspacePath: string) => Promise<AgentConfig>;
  saveConfig?: (workspacePath: string, config: AgentConfig) => Promise<void>;
  resolveWorkspacePath?: (cwd: string) => Promise<string>;
};

export function createTuiConfig(options: TuiCommandOptions = {}): AgentConfig {
  return {
    workspacePath: options.workspacePath ?? options.resolvedWorkspacePath ?? options.cwd ?? process.cwd(),
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
    appendSystemPrompt: options.appendSystemPrompt,
    skills: options.skills,
    mcpServers: options.mcpServers,
    tools: options.tools,
    permissionPolicy: options.permissionPolicy
  };
}

export async function runTuiCommand(
  options: TuiCommandOptions = {},
  dependencies: TuiCommandDependencies = {}
): Promise<void> {
  const resolveWorkspacePath = dependencies.resolveWorkspacePath ?? resolveDefaultWorkspacePath;
  const resolvedWorkspacePath = options.workspacePath ?? (await resolveWorkspacePath(options.cwd ?? process.cwd()));
  const runtimeConfig = createTuiConfig({ ...options, resolvedWorkspacePath });
  const loadConfig =
    dependencies.loadConfig ??
    ((workspacePath: string) => {
      return ensureDefaultAgentConfig(new FileAgentConfigStore(workspacePath));
    });
  const storedConfig = sanitizeUserFacingConfig(await loadConfig(runtimeConfig.workspacePath ?? process.cwd()));
  const config = mergeAgentConfig(storedConfig, runtimeConfig);

  if (dependencies.render) {
    await dependencies.render(config);
    return;
  }

  const sessionFactory = new AgentSessionFactory();
  const workspacePath = config.workspacePath ?? process.cwd();
  const sessionMetadataStore = new SessionMetadataStore(workspacePath);
  const saveConfig =
    dependencies.saveConfig ??
    ((workspacePath: string, nextConfig: AgentConfig) => {
      return new FileAgentConfigStore(workspacePath).save(nextConfig);
    });
  renderInk(
    React.createElement(AgentTui, {
        config,
        createSession: (sessionConfig: AgentConfig) => sessionFactory.create(sessionConfig),
        saveConfig: (nextConfig: AgentConfig) => saveConfig(nextConfig.workspacePath ?? process.cwd(), nextConfig),
        sessionMetadataStore
      })
  );
}

function sanitizeUserFacingConfig(config: AgentConfig): AgentConfig {
  const { adapter: _adapter, ...rest } = config;
  return rest;
}
