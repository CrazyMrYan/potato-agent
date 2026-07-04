import type { AgentEvent, RunTaskInput, TaskFailedEvent, TaskFinishedEvent } from "@coding-agent/protocol";
import type { DiffService } from "../diff/DiffService.js";
import type { PiAdapter } from "../pi/PiAdapter.js";
import type { RuntimeCapabilityReport, TraceStore } from "../trace/TraceStore.js";
import { nowIso } from "../trace/TraceStore.js";

export type AgentLoopDependencies = {
  traceStore?: TraceStore;
  diffService?: DiffService;
  runtimeCapability?: RuntimeCapabilityReport;
};

export class AgentLoop {
  constructor(
    private readonly adapter: PiAdapter,
    private readonly dependencies: AgentLoopDependencies = {}
  ) {}

  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "task.input", input });
    if (this.dependencies.runtimeCapability) {
      await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "runtime.capability", capability: this.dependencies.runtimeCapability });
    }

    const started: AgentEvent = {
      type: "task.started",
      taskId: input.taskId,
      workspacePath: input.workspacePath,
      prompt: input.prompt
    };
    await this.traceEvent(started);
    yield started;

    let finalEvent: TaskFinishedEvent | TaskFailedEvent | undefined;
    for await (const event of this.adapter.run(input)) {
      if (event.type === "task.finished" || event.type === "task.failed") {
        finalEvent = event;
        continue;
      }

      await this.traceEvent(event);
      yield event;
    }

    if (finalEvent?.type !== "task.failed") {
      const changeSet = await this.tryGetChangeSet(input.workspacePath);
      if (changeSet) {
        await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "diff", changeSet });
        if (changeSet.files.length > 0) {
          const diffEvent: AgentEvent = { type: "diff.produced", taskId: input.taskId, changeSet };
          await this.traceEvent(diffEvent);
          yield diffEvent;
        }
      }
    }

    if (finalEvent) {
      await this.traceEvent(finalEvent);
      if (finalEvent.type === "task.finished") {
        await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "task.finished", summary: finalEvent.summary });
      } else {
        await this.trace({
          timestamp: nowIso(),
          taskId: input.taskId,
          kind: "task.failed",
          code: finalEvent.error.code,
          message: finalEvent.error.message,
          cause: finalEvent.error.cause
        });
      }
      yield finalEvent;
    }
  }

  private async traceEvent(event: AgentEvent): Promise<void> {
    await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "event", event });
  }

  private async trace(entry: Parameters<TraceStore["append"]>[0]): Promise<void> {
    await this.dependencies.traceStore?.append(entry);
  }

  private async tryGetChangeSet(workspacePath: string) {
    try {
      return await this.dependencies.diffService?.getChangeSet(workspacePath);
    } catch {
      return undefined;
    }
  }
}
