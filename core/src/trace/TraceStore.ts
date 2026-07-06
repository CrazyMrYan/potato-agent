import type { AgentEvent, ChangeSet, RunTaskInput } from "@potato/protocol";

export type TraceEntry =
  | { timestamp: string; taskId: string; kind: "task.input"; input: RunTaskInput }
  | { timestamp: string; taskId: string; kind: "event"; event: AgentEvent }
  | { timestamp: string; taskId: string; kind: "diff"; changeSet: ChangeSet }
  | { timestamp: string; taskId: string; kind: "task.finished"; summary: string }
  | { timestamp: string; taskId: string; kind: "task.failed"; code: string; message: string; cause?: string }
  | { timestamp: string; taskId: string; kind: "runtime.capability"; capability: RuntimeCapabilityReport };

export type RuntimeCapabilityReport = {
  adapter: "rpc" | "sdk" | "runtime";
  systemPrompt: boolean;
  skills: boolean;
  mcpServers: boolean;
  toolAllowDeny: boolean;
  toolInterception: boolean;
  toolBoundaryApproval: boolean;
  notes: string[];
};

export type TraceSummary = {
  taskId: string;
  path: string;
  updatedAt: string;
  entries: number;
};

export interface TraceStore {
  append(entry: TraceEntry): Promise<void>;
  read(taskId: string): Promise<TraceEntry[]>;
  list(): Promise<TraceSummary[]>;
}

export function nowIso(): string {
  return new Date().toISOString();
}
