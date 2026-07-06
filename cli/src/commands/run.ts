import type { RunTaskInput } from "@potato/protocol";
import {
  AgentOrchestrator,
  GitDiffService,
  HeuristicContextBudgetManager,
  JsonlTraceStore,
  LocalAgentGateway,
  SubAgentManager,
  type DiffService,
  type PiAdapter,
  PiRpcAdapter,
  resolveDefaultWorkspacePath,
  resolvePiAdapterOptions,
  type TraceStore
} from "@potato/core";
import { EventStreamRenderer } from "../ui/EventStreamRenderer.js";

export class RenderedTaskFailedError extends Error {
  readonly alreadyRendered = true;
}

export type RunCommandOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
  workspacePath?: string;
  cwd?: string;
  timeoutMs?: number;
  createAdapter?: (options: Required<Pick<RunCommandOptions, "workspacePath">> & RunCommandOptions) => PiAdapter;
  createTraceStore?: (workspacePath: string) => TraceStore;
  createDiffService?: () => DiffService;
  resolveWorkspacePath?: (cwd: string) => Promise<string>;
  write?: (line: string) => void;
};

export function createAdapter(options: RunCommandOptions): PiAdapter {
  return new PiRpcAdapter(resolvePiAdapterOptions(options));
}

export async function runCommand(prompt: string, options: RunCommandOptions = {}): Promise<void> {
  const taskId = `task_${Date.now()}`;
  const workspacePath = options.workspacePath ?? (await (options.resolveWorkspacePath ?? resolveDefaultWorkspacePath)(options.cwd ?? process.cwd()));
  const input: RunTaskInput = {
    taskId,
    workspacePath,
    prompt,
    mode: "run",
    approvalMode: "manual"
  };

  const subAgentManager = new SubAgentManager();
  const runtimeConfig = await subAgentManager.applyActive({ ...options, workspacePath });
  const activeSubAgent = (await subAgentManager.list()).find((agent) => agent.id === runtimeConfig.activeSubAgentId);
  const adapter = options.createAdapter ? options.createAdapter({ workspacePath, ...runtimeConfig }) : createAdapter({ ...runtimeConfig, workspacePath });
  const traceStore = options.createTraceStore ? options.createTraceStore(workspacePath) : new JsonlTraceStore(workspacePath);
  const diffService = options.createDiffService ? options.createDiffService() : new GitDiffService();
  const gateway = new LocalAgentGateway(new AgentOrchestrator(adapter, { traceStore, diffService, subAgent: activeSubAgent, contextBudget: new HeuristicContextBudgetManager() }));
  const write = options.write ?? console.log;
  const renderer = new EventStreamRenderer();

  for await (const event of gateway.runTask(input)) {
    const rendered = renderer.render(event);
    if (rendered) {
      write(rendered);
    }

    if (event.type === "task.failed") {
      throw new RenderedTaskFailedError(`${event.error.code} ${event.error.message}`);
    }
  }

  const remaining = renderer.flush();
  if (remaining) {
    write(remaining);
  }
}
