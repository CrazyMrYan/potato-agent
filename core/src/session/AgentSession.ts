import type { AgentEvent, RunTaskInput } from "@potato/protocol";
import type { ContextBudgetManager } from "../context/ContextBudget.js";
import type { PiSessionAdapter } from "../pi/PiSessionAdapter.js";
import type { SubAgentConfig } from "../subagent/SubAgentConfig.js";
import type { TraceStore } from "../trace/TraceStore.js";
import { nowIso } from "../trace/TraceStore.js";

export class AgentSession {
  private activeTaskId?: string;
  private readonly cancelledTaskIds = new Set<string>();

  constructor(
    private readonly adapter: PiSessionAdapter,
    private readonly traceStore?: TraceStore,
    private readonly workspacePath: string = process.cwd(),
    private readonly subAgent?: SubAgentConfig,
    private readonly contextBudget?: ContextBudgetManager
  ) {}

  start(): Promise<void> {
    return this.adapter.start();
  }

  stop(): Promise<void> {
    return this.adapter.stop();
  }

  async cancelCurrentTask(): Promise<void> {
    const taskId = this.activeTaskId;
    if (taskId) {
      this.cancelledTaskIds.add(taskId);
    }
    if (this.adapter.cancelCurrentTask) {
      await this.adapter.cancelCurrentTask();
      return;
    }
    await this.adapter.stop();
  }

  adapterName(): "rpc" | "runtime" | "sdk" | "unknown" {
    return this.adapter.name ?? "unknown";
  }

  async *send(prompt: string): AsyncIterable<AgentEvent> {
    let input: RunTaskInput | undefined;

    try {
      for await (const event of this.adapter.send(prompt)) {
        if (!input) {
          input = {
            taskId: event.taskId,
            workspacePath: this.workspacePath,
            prompt,
            mode: "run",
            approvalMode: "manual"
          };
          this.activeTaskId = event.taskId;
          await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "task.input", input });
          yield* this.prepareContext(input);
          if (this.subAgent && this.subAgent.id !== "default" && this.subAgent.enabled !== false) {
            yield* this.emitSubAgentStart(event.taskId, this.subAgent);
          }
        }

        if (this.cancelledTaskIds.has(event.taskId)) {
          yield* this.emitCancelled(event.taskId);
          return;
        }

        await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "event", event });
        if (event.type === "task.finished") {
          this.contextBudget?.record?.(input, event.summary);
          if (this.subAgent && this.subAgent.id !== "default" && this.subAgent.enabled !== false) {
            yield* this.emitSubAgentFinish(event.taskId, this.subAgent, event.summary);
          }
          await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "task.finished", summary: event.summary });
        }
        if (event.type === "task.failed") {
          this.contextBudget?.record?.(input, event.error.message);
          if (this.subAgent && this.subAgent.id !== "default" && this.subAgent.enabled !== false) {
            const failed: AgentEvent = {
              type: "subagent.failed",
              taskId: event.taskId,
              subAgentId: this.subAgent.id,
              name: this.subAgent.name,
              error: event.error
            };
            await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "event", event: failed });
            yield failed;
          }
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
    } catch (error) {
      if (this.activeTaskId && this.cancelledTaskIds.has(this.activeTaskId)) {
        yield* this.emitCancelled(this.activeTaskId);
        return;
      }
      throw error;
    } finally {
      if (this.activeTaskId) {
        this.cancelledTaskIds.delete(this.activeTaskId);
      }
      this.activeTaskId = undefined;
    }
  }

  private async *emitCancelled(taskId: string): AsyncIterable<AgentEvent> {
    const event: AgentEvent = {
      type: "task.failed",
      taskId,
      error: { code: "TASK_CANCELLED", message: "Task cancelled by user." }
    };
    await this.trace({ timestamp: nowIso(), taskId, kind: "event", event });
    await this.trace({ timestamp: nowIso(), taskId, kind: "task.failed", code: event.error.code, message: event.error.message });
    yield event;
  }

  private async *emitSubAgentStart(taskId: string, subAgent: SubAgentConfig): AsyncIterable<AgentEvent> {
    const events: AgentEvent[] = [
      { type: "subagent.selected", taskId, subAgentId: subAgent.id, name: subAgent.name, description: subAgent.description },
      { type: "subagent.started", taskId, subAgentId: subAgent.id, name: subAgent.name }
    ];
    for (const event of events) {
      await this.trace({ timestamp: nowIso(), taskId, kind: "event", event });
      yield event;
    }
  }

  private async *emitSubAgentFinish(taskId: string, subAgent: SubAgentConfig, summary: string): AsyncIterable<AgentEvent> {
    const event: AgentEvent = { type: "subagent.finished", taskId, subAgentId: subAgent.id, name: subAgent.name, summary };
    await this.trace({ timestamp: nowIso(), taskId, kind: "event", event });
    yield event;
  }

  approve(requestId: string, approved: boolean): Promise<void> {
    if (!this.adapter.respondToApproval) {
      throw new Error("当前 Agent adapter 不支持交互式审批。");
    }

    return this.adapter.respondToApproval(requestId, approved);
  }

  async rejectAndPause(requestId: string): Promise<void> {
    await this.approve(requestId, false);
    await this.stop();
  }

  async *compactContext(reason: "manual" | "automatic" = "manual"): AsyncIterable<AgentEvent> {
    const taskId = `${reason}_compact`;
    if (this.adapter.compact) {
      try {
        const result = await this.adapter.compact(`${reason} context compaction`);
        const compacted = {
          summary: result.summary,
          originalTokens: result.originalTokens ?? 0,
          compactedTokens: result.compactedTokens ?? 0
        };
        const event: AgentEvent = {
          type: "context.compacted",
          taskId,
          summary: compacted.summary,
          originalTokens: compacted.originalTokens,
          compactedTokens: compacted.compactedTokens
        };
        await this.trace({ timestamp: nowIso(), taskId, kind: "context.compacted", result: compacted });
        await this.trace({ timestamp: nowIso(), taskId, kind: "event", event });
        yield event;
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isNothingToCompactError(message)) {
          const event: AgentEvent = {
            type: "context.compacted",
            taskId,
            summary: normalizeNothingToCompactMessage(message),
            originalTokens: 0,
            compactedTokens: 0
          };
          await this.trace({
            timestamp: nowIso(),
            taskId,
            kind: "context.compacted",
            result: {
              summary: event.summary,
              originalTokens: event.originalTokens,
              compactedTokens: event.compactedTokens
            }
          });
          await this.trace({ timestamp: nowIso(), taskId, kind: "event", event });
          yield event;
          return;
        }
        yield {
          type: "task.failed",
          taskId,
          error: {
            code: "UNKNOWN_ERROR",
            message
          }
        };
        return;
      }
    }

    if (!this.contextBudget) {
      yield {
        type: "task.failed",
        taskId,
        error: {
          code: "UNKNOWN_ERROR",
          message: "当前会话不支持主动压缩。"
        }
      };
      return;
    }

    const input: RunTaskInput = {
      taskId,
      workspacePath: this.workspacePath,
      prompt: `${reason} context compaction`,
      mode: "run",
      approvalMode: "manual"
    };
    yield* this.prepareContext(input, { force: true });
  }

  private async trace(entry: Parameters<TraceStore["append"]>[0]): Promise<void> {
    try {
      await this.traceStore?.append(entry);
    } catch {
      return;
    }
  }

  private async *prepareContext(input: RunTaskInput, options: { force?: boolean } = {}): AsyncIterable<AgentEvent> {
    if (!this.contextBudget) {
      return;
    }

    const budget = this.contextBudget.estimate(input);
    const budgetEvent: AgentEvent = {
      type: "context.budget",
      taskId: input.taskId,
      usedTokens: budget.usedTokens,
      maxTokens: budget.maxTokens,
      ratio: budget.ratio,
      compactAtRatio: this.contextBudget.compactAtRatio
    };
    await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "context.budget", budget });
    await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "event", event: budgetEvent });
    yield budgetEvent;

    if (!options.force && budget.ratio < this.contextBudget.compactAtRatio) {
      return;
    }

    const result = await this.contextBudget.compact(input, budget);
    const compactedEvent: AgentEvent = {
      type: "context.compacted",
      taskId: input.taskId,
      summary: result.summary,
      originalTokens: result.originalTokens,
      compactedTokens: result.compactedTokens
    };
    await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "context.compacted", result });
    await this.trace({ timestamp: nowIso(), taskId: input.taskId, kind: "event", event: compactedEvent });
    yield compactedEvent;
  }
}

function isNothingToCompactError(message: string): boolean {
  return /nothing to compact|session too small/i.test(message);
}

function normalizeNothingToCompactMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "Nothing to compact.";
  }
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}
