import type { AgentConfig } from "../config/AgentConfig.js";
import { type PiSessionAdapter, PiRpcSessionAdapter } from "../pi/PiSessionAdapter.js";
import { resolvePiAdapterOptions } from "../pi/resolvePiAdapterOptions.js";
import { SubAgentManager } from "../subagent/SubAgentManager.js";
import { JsonlTraceStore } from "../trace/JsonlTraceStore.js";
import type { TraceStore } from "../trace/TraceStore.js";
import { AgentSession } from "./AgentSession.js";

type AgentSessionFactoryDependencies = {
  createAdapter?: (config: AgentConfig) => PiSessionAdapter;
  createTraceStore?: (workspacePath: string) => TraceStore;
  createSubAgentManager?: () => Pick<SubAgentManager, "list">;
  env?: NodeJS.ProcessEnv;
};

export class AgentSessionFactory {
  constructor(private readonly dependencies: AgentSessionFactoryDependencies = {}) {}

  async create(config: AgentConfig): Promise<AgentSession> {
    const workspacePath = config.workspacePath ?? process.cwd();
    const resolved = { ...config, workspacePath };
    const adapter =
      this.dependencies.createAdapter?.(resolved) ??
      new PiRpcSessionAdapter(resolvePiAdapterOptions({ ...resolved, env: this.dependencies.env }));
    const traceStore = this.dependencies.createTraceStore
      ? this.dependencies.createTraceStore(workspacePath)
      : new JsonlTraceStore(workspacePath);

    const subAgentManager = this.dependencies.createSubAgentManager?.() ?? new SubAgentManager();
    const activeSubAgent = (await subAgentManager.list()).find((agent) => agent.id === resolved.activeSubAgentId);

    return new AgentSession(adapter, traceStore, workspacePath, activeSubAgent);
  }
}
