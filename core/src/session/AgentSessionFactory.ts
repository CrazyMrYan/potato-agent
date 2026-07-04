import type { AgentConfig } from "../config/AgentConfig.js";
import { type PiSessionAdapter, PiRpcSessionAdapter } from "../pi/PiSessionAdapter.js";
import { resolvePiAdapterOptions } from "../pi/resolvePiAdapterOptions.js";
import { JsonlTraceStore } from "../trace/JsonlTraceStore.js";
import type { TraceStore } from "../trace/TraceStore.js";
import { AgentSession } from "./AgentSession.js";

type AgentSessionFactoryDependencies = {
  createAdapter?: (config: AgentConfig) => PiSessionAdapter;
  createTraceStore?: (workspacePath: string) => TraceStore;
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
    const traceStore = this.dependencies.createTraceStore
      ? this.dependencies.createTraceStore(workspacePath)
      : new JsonlTraceStore(workspacePath);

    return new AgentSession(adapter, traceStore, workspacePath);
  }
}
