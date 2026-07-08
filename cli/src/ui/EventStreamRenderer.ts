import type { AgentEvent, ChangeSet } from "@potato/protocol";
import pc from "picocolors";
import { renderChangeSet, type RenderedDiffLine } from "./DiffRenderer.js";
import { renderMarkdownText } from "./MarkdownRenderer.js";

export type EventStreamRendererOptions = {
  colors?: boolean;
  maxToolOutputLength?: number;
  streamText?: boolean;
  streamDetails?: boolean;
  collectThinking?: boolean;
};

export type RenderedAgentEventKind =
  | "user"
  | "step"
  | "thinking"
  | "text"
  | "tool"
  | "success"
  | "warning"
  | "error"
  | "diff"
  | "diffFile"
  | "diffHunk"
  | "diffAdd"
  | "diffRemove"
  | "diffContext"
  | "todoDetail"
  | "context"
  | "muted";

export type RenderedAgentEvent = {
  kind: RenderedAgentEventKind;
  text: string;
  replacePrevious?: boolean;
};

export class EventStreamRenderer {
  private pendingText = "";
  private pendingThinking = "";
  private lastRenderedAssistantText = "";
  private streamedAssistantText = "";
  private readonly colors: boolean;
  private readonly maxToolOutputLength: number;
  private readonly streamText: boolean;
  private readonly streamDetails: boolean;
  private readonly collectThinking: boolean;

  constructor(options: EventStreamRendererOptions = {}) {
    this.colors = options.colors ?? true;
    this.maxToolOutputLength = options.maxToolOutputLength ?? 120;
    this.streamText = options.streamText ?? false;
    this.streamDetails = options.streamDetails ?? false;
    this.collectThinking = options.collectThinking ?? false;
  }

  render(event: AgentEvent): string {
    return this.renderEvent(event)
      .map((item) => item.text)
      .join("\n");
  }

  renderEvent(event: AgentEvent): RenderedAgentEvent[] {
    if (event.type === "assistant.delta") {
      if (event.channel === "thinking") {
        if (this.streamDetails || this.collectThinking) {
          return [{ kind: "thinking", text: this.dim(event.text) }];
        }
        this.pendingThinking += event.text;
        return [];
      }

      if (this.streamText) {
        this.streamedAssistantText += event.text;
        this.lastRenderedAssistantText = normalizeRenderedText(this.streamedAssistantText);
        return [{ kind: "text", text: event.text }];
      }

      this.pendingText += event.text;
      return [];
    }

    if (event.type === "diff.produced") {
      return [...this.flushEvents(), ...this.renderDiff(event.changeSet)].filter((item) => item.text.length > 0);
    }

    if (event.type === "todo.updated") {
      return [...this.flushEvents(), ...this.renderTodoUpdate(event.todos)].filter((item) => item.text.length > 0);
    }

    if (event.type === "verification.started") {
      return [...this.flushEvents(), { kind: "muted" as const, text: this.dim(`verification started: ${event.command}`) }].filter((item) => item.text.length > 0);
    }

    if (event.type === "verification.finished") {
      const result =
        event.exitCode === 0
          ? [{ kind: "success" as const, text: this.green(`verification passed: ${event.command}`) }]
          : [
              { kind: "error" as const, text: this.red(`verification failed: ${event.command} exit=${event.exitCode}`) },
              { kind: "tool" as const, text: this.formatToolOutput(event.output) }
            ];
      return [...this.flushEvents(), ...result].filter((item) => item.text.length > 0);
    }

    return [...this.flushEvents(), this.renderImmediate(event)].filter((item) => item.text.length > 0);
  }

  flush(): string {
    return this.flushEvents()
      .map((item) => item.text)
      .join("\n");
  }

  flushEvents(): RenderedAgentEvent[] {
    const events: RenderedAgentEvent[] = [];

    if (this.pendingThinking.trim()) {
      events.push({ kind: "thinking", text: this.dim(compactInline(this.pendingThinking)) });
      this.pendingThinking = "";
    }

    if (this.pendingText.trim()) {
      const text = renderMarkdownText(this.pendingText, { colors: this.colors });
      this.lastRenderedAssistantText = normalizeRenderedText(text);
      events.push({ kind: "text", text });
      this.pendingText = "";
    }

    return events;
  }

  private renderImmediate(event: Exclude<AgentEvent, { type: "assistant.delta" }>): RenderedAgentEvent {
    switch (event.type) {
      case "task.started":
        return { kind: "user", text: this.cyan(event.prompt) };
      case "step.started":
        return { kind: "step", text: this.blue(event.title) };
      case "tool.started":
        return { kind: "tool", text: this.gray(joinParts(event.tool, event.summary)) };
      case "tool.finished":
        return event.success
          ? { kind: "success", text: this.green(joinParts(event.tool, event.output ? this.formatToolOutput(event.output) : undefined)) }
          : { kind: "error", text: this.red(joinParts(event.tool, event.output ? this.formatToolOutput(event.output) : undefined)) };
      case "approval.requested":
        return { kind: "warning", text: this.yellow(event.request.title) };
      case "subagent.selected":
        return { kind: "step", text: this.blue(`SubAgent selected: ${event.name} (${event.subAgentId})`) };
      case "subagent.started":
        return { kind: "step", text: this.blue(`SubAgent started: ${event.name}`) };
      case "subagent.finished":
        return { kind: "success", text: this.green(`SubAgent finished: ${event.name}`) };
      case "subagent.failed":
        return { kind: "error", text: this.red(`SubAgent failed: ${event.name} ${event.error.message}`) };
      case "diff.produced":
        return { kind: "diff", text: this.renderDiff(event.changeSet).map((line) => line.text).join("\n") };
      case "context.budget":
        return { kind: "context", text: formatContextBudget(event.usedTokens, event.maxTokens, event.ratio, event.compactAtRatio) };
      case "context.compacted":
        if (event.originalTokens === 0 && event.compactedTokens === 0) {
          return { kind: "muted", text: this.dim(`context compact skipped: ${event.summary}`) };
        }
        return { kind: "warning", text: this.yellow(`context compacted ${event.originalTokens} -> ${event.compactedTokens} tokens`) };
      case "todo.updated":
        return { kind: "step", text: this.blue(formatTodoSummary(event.todos)) };
      case "prompt.cache":
        return { kind: "muted", text: this.dim(formatPromptCache(event.cachedTokens, event.inputTokens, event.cacheWriteTokens)) };
      case "verification.started":
        return { kind: "muted", text: this.dim(`verification started: ${event.command}`) };
      case "verification.finished":
        return event.exitCode === 0
          ? { kind: "success", text: this.green(`verification passed: ${event.command}`) }
          : { kind: "error", text: this.red(`verification failed: ${event.command} exit=${event.exitCode}`) };
      case "task.finished":
        return this.renderTaskFinished(event.summary);
      case "task.failed":
        if (event.error.code === "TASK_CANCELLED") {
          return { kind: "warning", text: this.yellow("任务已取消。") };
        }
        if (isNothingToCompactFailure(event.taskId, event.error.message)) {
          return { kind: "muted", text: this.dim(`context compact skipped: ${normalizeNothingToCompactMessage(event.error.message)}`) };
        }
        return { kind: "error", text: this.red(`${event.error.code} ${event.error.message}`) };
    }
    return assertNever(event);
  }

  private formatToolOutput(output: string): string {
    return truncate(compactInline(output), this.maxToolOutputLength);
  }

  private renderTaskFinished(summary: string): RenderedAgentEvent {
    const text = renderMarkdownText(summary, { colors: this.colors });
    if (this.streamText && this.streamedAssistantText.trim()) {
      this.lastRenderedAssistantText = normalizeRenderedText(text);
      this.streamedAssistantText = "";
      return { kind: "text", text, replacePrevious: true };
    }
    if (text && normalizeRenderedText(text) === this.lastRenderedAssistantText) {
      return { kind: "text", text: "" };
    }
    this.lastRenderedAssistantText = normalizeRenderedText(text);
    return { kind: "text", text };
  }

  private cyan(value: string): string {
    return this.colors ? pc.cyan(value) : value;
  }

  private blue(value: string): string {
    return this.colors ? pc.blue(value) : value;
  }

  private gray(value: string): string {
    return this.colors ? pc.gray(value) : value;
  }

  private green(value: string): string {
    return this.colors ? pc.green(value) : value;
  }

  private red(value: string): string {
    return this.colors ? pc.red(value) : value;
  }

  private yellow(value: string): string {
    return this.colors ? pc.yellow(value) : value;
  }

  private magenta(value: string): string {
    return this.colors ? pc.magenta(value) : value;
  }

  private dim(value: string): string {
    return this.colors ? pc.dim(value) : value;
  }

  private renderDiff(changeSet: ChangeSet): RenderedAgentEvent[] {
    return renderChangeSet(changeSet).map((line) => this.renderDiffLine(line));
  }

  private renderTodoUpdate(todos: Array<{ content: string; status: string }>): RenderedAgentEvent[] {
    const events: RenderedAgentEvent[] = [{ kind: "step", text: this.blue(formatTodoSummary(todos)) }];
    if (this.streamDetails) {
      events.push(...todos.map((todo) => ({ kind: "todoDetail" as const, text: this.dim(`  ${todoStatusMarker(todo.status)} ${todo.content}`) })));
    }
    return events;
  }

  private renderDiffLine(line: RenderedDiffLine): RenderedAgentEvent {
    switch (line.kind) {
      case "header":
        return { kind: "diff", text: this.magenta(line.text) };
      case "file":
        return { kind: "diffFile", text: this.blue(line.text) };
      case "hunk":
        return { kind: "diffHunk", text: this.dim(line.text) };
      case "add":
        return { kind: "diffAdd", text: this.green(line.text) };
      case "remove":
        return { kind: "diffRemove", text: this.red(line.text) };
      case "context":
        return { kind: "diffContext", text: this.dim(line.text) };
    }
  }
}

function compactInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeRenderedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function assertNever(value: never): never {
  throw new Error(`Unhandled event: ${JSON.stringify(value)}`);
}

function joinParts(first: string, second: string | undefined): string {
  return second ? `${first} ${second}` : first;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function formatContextBudget(usedTokens: number, maxTokens: number, ratio: number, compactAtRatio: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  const ring = `${"◉".repeat(filled)}${"○".repeat(10 - filled)}`;
  const percent = ratio > 0 && ratio < 0.01 ? "<1%" : `${Math.round(ratio * 100)}%`;
  return `context ${ring} ${percent} · ${usedTokens}/${maxTokens} tokens · compact at ${Math.round(compactAtRatio * 100)}%`;
}

function formatTodoSummary(todos: Array<{ status: string }>): string {
  const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
  const completed = todos.filter((todo) => todo.status === "completed").length;
  return `todo 已更新：${todos.length} 项 · ${inProgress} 进行中 · ${completed} 已完成`;
}

function todoStatusMarker(status: string): string {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "●";
  return "○";
}

function formatPromptCache(cachedTokens: number, inputTokens: number | undefined, cacheWriteTokens: number | undefined): string {
  const parts = [`缓存命中：${cachedTokens} tokens`];
  if (inputTokens !== undefined) {
    parts.push(`输入 ${inputTokens} tokens`);
  }
  if (cacheWriteTokens !== undefined) {
    parts.push(`写入缓存 ${cacheWriteTokens} tokens`);
  }
  return parts.join(" · ");
}

function isNothingToCompactFailure(taskId: string, message: string): boolean {
  return taskId.endsWith("_compact") && /nothing to compact|session too small/i.test(message);
}

function normalizeNothingToCompactMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "Nothing to compact.";
  }
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}
