import type { AgentConfig } from "../config/AgentConfig.js";
import { type PiSessionAdapter, PiRpcSessionAdapter } from "../pi/PiSessionAdapter.js";
import { resolvePiAdapterOptions } from "../pi/resolvePiAdapterOptions.js";
import { AgentSession } from "./AgentSession.js";

type AgentSessionFactoryDependencies = {
  createAdapter?: (config: AgentConfig) => PiSessionAdapter;
  env?: NodeJS.ProcessEnv;
};

export class AgentSessionFactory {
  constructor(private readonly dependencies: AgentSessionFactoryDependencies = {}) {}

  create(config: AgentConfig): AgentSession {
    const workspacePath = config.workspacePath ?? process.cwd();
    const resolved = { ...config, workspacePath };
    const adapter =
      this.dependencies.createAdapter?.(resolved) ??
      new PiRpcSessionAdapter(resolvePiAdapterOptions({ ...resolved, env: this.dependencies.env }));

    return new AgentSession(adapter);
  }
}
