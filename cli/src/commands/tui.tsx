import { h } from "vue";
import { createApp } from "@vue-tui/runtime";
import {
  AgentSessionFactory,
  ensureDefaultAgentConfig,
  FileAgentConfigStore,
  mergeAgentConfig,
  resolveDefaultWorkspacePath,
  type AgentConfig
} from "@coding-agent/core";
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
    timeoutMs: options.timeoutMs
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
  createApp({
    render: () =>
      h(AgentTui, {
        config,
        createSession: (sessionConfig: AgentConfig) => sessionFactory.create(sessionConfig),
        saveConfig: (nextConfig: AgentConfig) => saveConfig(nextConfig.workspacePath ?? process.cwd(), nextConfig)
      })
  }).mount();
}
