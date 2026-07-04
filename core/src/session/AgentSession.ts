import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import type { PiSessionAdapter } from "../pi/PiSessionAdapter.js";
import type { TraceStore } from "../trace/TraceStore.js";
import { nowIso } from "../trace/TraceStore.js";

export class AgentSession {
  constructor(
    private readonly adapter: PiSessionAdapter,
    private readonly traceStore?: TraceStore,
    private readonly workspacePath: string = process.cwd()
  ) {}

  start(): Promise<void> {
    return this.adapter.start();
  }

  stop(): Promise<void> {
    return this.adapter.stop();
  }

  async *send(prompt: string): AsyncIterable<AgentEvent> {
    let input: RunTaskInput | undefined;

    for await (const event of this.adapter.send(prompt)) {
      if (!input) {
        input = {
          taskId: event.taskId,
          workspacePath: this.workspacePath,
          prompt,
          mode: "run",
          approvalMode: "manual"
        };
        await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "task.input", input });
      }

      await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "event", event });
      if (event.type === "task.finished") {
        await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "task.finished", summary: event.summary });
      }
      if (event.type === "task.failed") {
        await this.trace({
          timestamp: nowIso(),
          taskId: event.taskId,
          kind: "task.failed",
          code: event.error.code,
          message: event.error.message,
          cause: event.error.cause
        });
      }
      yield event;
    }
  }

  private async trace(entry: Parameters<TraceStore["append"]>[0]): Promise<void> {
    try {
      await this.traceStore?.append(entry);
    } catch {
      return;
    }
  }
}
