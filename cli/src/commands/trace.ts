import { JsonlTraceStore, type TraceStore } from "@coding-agent/core";

export type TraceCommandOptions = {
  workspacePath?: string;
  taskId?: string;
  raw?: boolean;
  write?: (line: string) => void;
  traceStore?: TraceStore;
};

export async function traceCommand(options: TraceCommandOptions = {}): Promise<void> {
  const workspacePath = options.workspacePath ?? process.cwd();
  const write = options.write ?? console.log;
  const traceStore = options.traceStore ?? new JsonlTraceStore(workspacePath);

  if (!options.taskId) {
    const traces = await traceStore.list();
    if (traces.length === 0) {
      write("No traces.");
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
