import type { AgentEvent, RunTaskInput } from "@potato/protocol";
import type { ContextBudgetManager } from "../context/ContextBudget.js";
import type { PiSessionAdapter } from "../pi/PiSessionAdapter.js";
import type { SubAgentConfig } from "../subagent/SubAgentConfig.js";
import type { TraceStore } from "../trace/TraceStore.js";
import { nowIso } from "../trace/TraceStore.js";

export class AgentSession {
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
        yield* this.prepareContext(input);
        if (this.subAgent && this.subAgent.id !== "default" && this.subAgent.enabled !== false) {
          yield* this.emitSubAgentStart(event.taskId, this.subAgent);
        }
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

  private async trace(entry: Parameters<TraceStore["append"]>[0]): Promise<void> {
    try {
      await this.traceStore?.append(entry);
    } catch {
      return;
    }
  }

  private async *prepareContext(input: RunTaskInput): AsyncIterable<AgentEvent> {
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

    if (budget.ratio < this.contextBudget.compactAtRatio) {
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
