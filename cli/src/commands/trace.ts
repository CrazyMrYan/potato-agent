import { JsonlTraceStore, resolveDefaultWorkspacePath, type TraceEntry, type TraceStore } from "@potato/core";

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
      write("No traces yet. Run an potato task first with `potato run` or the TUI.");
      return;
    }

    for (const trace of traces) {
      write(`${trace.taskId} ${trace.entries} entries ${trace.updatedAt}`);
    }
    write("Use `potato trace latest` or `potato trace <taskId>` to inspect entries.");
    return;
  }

  const taskId = options.taskId === "latest" ? await resolveLatestTaskId(traceStore) : options.taskId;
  const entries = await traceStore.read(taskId);
  if (!options.raw) {
    write(`trace ${taskId}`);
  }
  for (const entry of entries) {
    write(options.raw ? JSON.stringify(entry) : formatTraceEntry(entry));
  }
}

async function resolveLatestTaskId(traceStore: TraceStore): Promise<string> {
  const traces = await traceStore.list();
  const latest = traces[0];
  if (!latest) {
    throw new Error("No traces yet.");
  }
  return latest.taskId;
}

export function formatTraceEntry(entry: TraceEntry): string {
  if (entry.kind === "task.input") {
    return `${entry.timestamp} task.input ${entry.input.prompt}`;
  }
  if (entry.kind === "task.finished") {
    return `${entry.timestamp} task.finished ${entry.summary}`;
  }
  if (entry.kind === "task.failed") {
    return `${entry.timestamp} task.failed ${entry.code} ${entry.message}`;
  }
  if (entry.kind === "diff") {
    return `${entry.timestamp} diff ${entry.changeSet.files.length} files`;
  }
  if (entry.kind === "runtime.capability") {
    return `${entry.timestamp} runtime.capability ${entry.capability.adapter}`;
  }

  const event = entry.event;
  switch (event.type) {
    case "subagent.selected":
      return `${entry.timestamp} subagent.selected ${event.name} (${event.subAgentId})`;
    case "subagent.started":
      return `${entry.timestamp} subagent.started ${event.name} (${event.subAgentId})`;
    case "subagent.finished":
      return `${entry.timestamp} subagent.finished ${event.name} (${event.subAgentId})`;
    case "subagent.failed":
      return `${entry.timestamp} subagent.failed ${event.name} (${event.subAgentId}) ${event.error.message}`;
    case "step.started":
      return `${entry.timestamp} step.started ${event.title}`;
    case "tool.started":
      return `${entry.timestamp} tool.started ${event.tool} ${event.summary}`;
    case "tool.finished":
      return `${entry.timestamp} tool.finished ${event.tool} ${event.success ? "ok" : "failed"}${event.output ? ` ${event.output}` : ""}`;
    case "approval.requested":
      return `${entry.timestamp} approval.requested ${event.request.title}`;
    case "diff.produced":
      return `${entry.timestamp} diff.produced ${event.changeSet.files.length} files`;
    case "task.started":
      return `${entry.timestamp} task.started ${event.prompt}`;
    case "task.finished":
      return `${entry.timestamp} task.finished ${event.summary}`;
    case "task.failed":
      return `${entry.timestamp} task.failed ${event.error.code} ${event.error.message}`;
    case "assistant.delta":
      return `${entry.timestamp} assistant.${event.channel} ${event.text.replace(/\s+/g, " ").trim()}`;
    case "verification.started":
      return `${entry.timestamp} verification.started ${event.command}`;
    case "verification.finished":
      return `${entry.timestamp} verification.finished ${event.command} exit=${event.exitCode}`;
  }
}
