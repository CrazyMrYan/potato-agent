import type { AgentEvent, RunTaskInput, TaskFailedEvent, TaskFinishedEvent } from "@potato/protocol";
import type { ContextBudgetManager } from "../context/ContextBudget.js";
import type { DiffService } from "../diff/DiffService.js";
import type { PiAdapter } from "../pi/PiAdapter.js";
import type { SubAgentConfig } from "../subagent/SubAgentConfig.js";
import type { RuntimeCapabilityReport, TraceStore } from "../trace/TraceStore.js";
import { nowIso } from "../trace/TraceStore.js";

export type AgentLoopDependencies = {
  traceStore?: TraceStore;
  diffService?: DiffService;
  runtimeCapability?: RuntimeCapabilityReport;
  subAgent?: SubAgentConfig;
  contextBudget?: ContextBudgetManager;
  abortSignal?: AbortSignal;
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

    for (const event of await this.prepareContext(input)) {
      await this.traceEvent(event);
      yield event;
    }

    const subAgent = this.dependencies.subAgent?.enabled === false ? undefined : this.dependencies.subAgent;
    if (subAgent && subAgent.id !== "default") {
      const selected: AgentEvent = {
        type: "subagent.selected",
        taskId: input.taskId,
        subAgentId: subAgent.id,
        name: subAgent.name,
        description: subAgent.description
      };
      await this.traceEvent(selected);
      yield selected;

      const subAgentStarted: AgentEvent = {
        type: "subagent.started",
        taskId: input.taskId,
        subAgentId: subAgent.id,
        name: subAgent.name
      };
      await this.traceEvent(subAgentStarted);
      yield subAgentStarted;
    }

    let finalEvent: TaskFinishedEvent | TaskFailedEvent | undefined;
    for await (const event of this.adapter.run(input, { signal: this.dependencies.abortSignal })) {
      if (this.dependencies.abortSignal?.aborted) {
        yield* this.cancelled(input.taskId);
        return;
      }
      if (event.type === "task.finished" || event.type === "task.failed") {
        finalEvent = event;
        continue;
      }

      await this.traceEvent(event);
      yield event;
    }

    if (subAgent && subAgent.id !== "default" && finalEvent) {
      const subAgentFinal: AgentEvent =
        finalEvent.type === "task.failed"
          ? {
              type: "subagent.failed",
              taskId: input.taskId,
              subAgentId: subAgent.id,
              name: subAgent.name,
              error: finalEvent.error
            }
          : {
              type: "subagent.finished",
              taskId: input.taskId,
              subAgentId: subAgent.id,
              name: subAgent.name,
              summary: finalEvent.summary
            };
      await this.traceEvent(subAgentFinal);
      yield subAgentFinal;
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
      this.dependencies.contextBudget?.record?.(input, finalEvent.type === "task.finished" ? finalEvent.summary : finalEvent.error.message);
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

  private async *cancelled(taskId: string): AsyncIterable<AgentEvent> {
    const cancelled: TaskFailedEvent = {
      type: "task.failed",
      taskId,
      error: { code: "TASK_CANCELLED", message: "Task cancelled by user." }
    };
    await this.traceEvent(cancelled);
    await this.trace({ timestamp: nowIso(), taskId, kind: "task.failed", code: cancelled.error.code, message: cancelled.error.message });
    yield cancelled;
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

  private async prepareContext(input: RunTaskInput): Promise<AgentEvent[]> {
    const manager = this.dependencies.contextBudget;
    if (!manager) {
      return [];
    }

    const budget = manager.estimate(input);
    const budgetEvent: AgentEvent = {
      type: "context.budget",
      taskId: input.taskId,
      usedTokens: budget.usedTokens,
      maxTokens: budget.maxTokens,
      ratio: budget.ratio,
      compactAtRatio: manager.compactAtRatio
    };
    await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "context.budget", budget });

    if (budget.ratio < manager.compactAtRatio) {
      return [budgetEvent];
    }

    const result = await manager.compact(input, budget);
    await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "context.compacted", result });
    return [
      budgetEvent,
      {
        type: "context.compacted",
        taskId: input.taskId,
        summary: result.summary,
        originalTokens: result.originalTokens,
        compactedTokens: result.compactedTokens
      }
    ];
  }
}
