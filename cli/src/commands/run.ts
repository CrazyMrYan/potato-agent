import type { RunTaskInput } from "@coding-agent/protocol";
import {
  AgentOrchestrator,
  GitDiffService,
  JsonlTraceStore,
  LocalAgentGateway,
  type DiffService,
  type PiAdapter,
  PiRpcAdapter,
  resolveDefaultWorkspacePath,
  resolvePiAdapterOptions,
  type TraceStore
} from "@coding-agent/core";
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

  const adapter = options.createAdapter ? options.createAdapter({ workspacePath, ...options }) : createAdapter({ ...options, workspacePath });
  const traceStore = options.createTraceStore ? options.createTraceStore(workspacePath) : new JsonlTraceStore(workspacePath);
  const diffService = options.createDiffService ? options.createDiffService() : new GitDiffService();
  const gateway = new LocalAgentGateway(new AgentOrchestrator(adapter, { traceStore, diffService }));
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
