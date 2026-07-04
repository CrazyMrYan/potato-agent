import { JsonlTraceStore, resolveDefaultWorkspacePath, type TraceStore } from "@coding-agent/core";

export type TraceCommandOptions = {
  workspacePath?: string;
  taskId?: string;
  raw?: boolean;
  cwd?: string;
  write?: (line: string) => void;
  traceStore?: TraceStore;
  traceStoreFactory?: (workspacePath: string) => TraceStore;
  resolveWorkspacePath?: (cwd: string) => Promise<string>;
};

export async function traceCommand(options: TraceCommandOptions = {}): Promise<void> {
  const workspacePath = options.workspacePath ?? (await (options.resolveWorkspacePath ?? resolveDefaultWorkspacePath)(options.cwd ?? process.cwd()));
  const write = options.write ?? console.log;
  const traceStore = options.traceStore ?? options.traceStoreFactory?.(workspacePath) ?? new JsonlTraceStore(workspacePath);

  if (!options.taskId) {
    const traces = await traceStore.list();
    if (traces.length === 0) {
      write("No traces yet. Run an agent task first with `agent run` or the TUI.");
      return;
    }

    for (const trace of traces) {
      write(`${trace.taskId} ${trace.entries} entries ${trace.updatedAt}`);
    }
    return;
  }

  const entries = await traceStore.read(options.taskId);
  for (const entry of entries) {
    write(options.raw ? JSON.stringify(entry) : `${entry.timestamp} ${entry.kind}`);
  }
}
