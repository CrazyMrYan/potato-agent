import type { AgentConfig } from "../config/AgentConfig.js";
import { HeuristicContextBudgetManager, type ContextBudgetManager } from "../context/ContextBudget.js";
import { type PiSessionAdapter, PiRpcSessionAdapter } from "../pi/PiSessionAdapter.js";
import { resolvePiAdapterOptions } from "../pi/resolvePiAdapterOptions.js";
import { RuntimeSessionAdapter, type RuntimeSessionAdapterDependencies } from "../runtime/RuntimeSessionAdapter.js";
import { SubAgentManager } from "../subagent/SubAgentManager.js";
import { JsonlTraceStore } from "../trace/JsonlTraceStore.js";
import type { TraceStore } from "../trace/TraceStore.js";
import { AgentSession } from "./AgentSession.js";

type AgentSessionFactoryDependencies = {
  createAdapter?: (config: AgentConfig) => PiSessionAdapter;
  createTraceStore?: (workspacePath: string) => TraceStore;
  createSubAgentManager?: () => Pick<SubAgentManager, "list">;
  createContextBudget?: () => ContextBudgetManager;
  runtime?: RuntimeSessionAdapterDependencies;
  env?: NodeJS.ProcessEnv;
};

export class AgentSessionFactory {
  constructor(private readonly dependencies: AgentSessionFactoryDependencies = {}) {}

  async create(config: AgentConfig): Promise<AgentSession> {
    const workspacePath = config.workspacePath ?? process.cwd();
    const resolved = { ...config, workspacePath };
    const adapter = this.dependencies.createAdapter?.(resolved) ?? this.createDefaultAdapter(resolved);
    const traceStore = this.dependencies.createTraceStore
      ? this.dependencies.createTraceStore(workspacePath)
      : new JsonlTraceStore(workspacePath);

    const subAgentManager = this.dependencies.createSubAgentManager?.() ?? new SubAgentManager();
    const activeSubAgent = (await subAgentManager.list()).find((agent) => agent.id === resolved.activeSubAgentId);
    const contextBudget = this.dependencies.createContextBudget?.() ?? new HeuristicContextBudgetManager();

    return new AgentSession(adapter, traceStore, workspacePath, activeSubAgent, contextBudget);
  }

  private createDefaultAdapter(config: AgentConfig): PiSessionAdapter {
    if (!config.adapter || config.adapter === "rpc") {
      return new PiRpcSessionAdapter(resolvePiAdapterOptions({ ...config, env: this.dependencies.env }));
    }

    return new RuntimeSessionAdapter(config, this.dependencies.runtime);
  }
}
