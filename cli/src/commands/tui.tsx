import React from "react";
import { render as inkRender } from "ink";
import { AgentSessionFactory, FileAgentConfigStore, mergeAgentConfig, type AgentConfig } from "@coding-agent/core";
import { AgentTui } from "../ui/AgentTui.js";

export type TuiCommandOptions = AgentConfig & {
  cwd?: string;
};

export type TuiCommandDependencies = {
  render?: (config: AgentConfig) => void | Promise<void>;
  loadConfig?: (workspacePath: string) => Promise<AgentConfig>;
  saveConfig?: (workspacePath: string, config: AgentConfig) => Promise<void>;
};

export function createTuiConfig(options: TuiCommandOptions = {}): AgentConfig {
  return {
    workspacePath: options.workspacePath ?? options.cwd ?? process.cwd(),
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs
  };
}

export async function runTuiCommand(
  options: TuiCommandOptions = {},
  dependencies: TuiCommandDependencies = {}
): Promise<void> {
  const runtimeConfig = createTuiConfig(options);
  const loadConfig =
    dependencies.loadConfig ??
    ((workspacePath: string) => {
      return new FileAgentConfigStore(workspacePath).load();
    });
  const storedConfig = await loadConfig(runtimeConfig.workspacePath ?? process.cwd());
  const config = mergeAgentConfig(storedConfig, runtimeConfig);

  if (dependencies.render) {
    await dependencies.render(config);
    return;
  }

  const sessionFactory = new AgentSessionFactory();
  const saveConfig =
    dependencies.saveConfig ??
    ((workspacePath: string, nextConfig: AgentConfig) => {
      return new FileAgentConfigStore(workspacePath).save(nextConfig);
    });
  inkRender(
    <AgentTui
      config={config}
      createSession={(sessionConfig) => sessionFactory.create(sessionConfig)}
      saveConfig={(nextConfig) => saveConfig(nextConfig.workspacePath ?? process.cwd(), nextConfig)}
    />
  );
}
