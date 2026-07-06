import type { AgentEvent } from "@potato/protocol";
import pc from "picocolors";
import { renderChangeSetLines } from "./DiffRenderer.js";
import { renderMarkdownText } from "./MarkdownRenderer.js";

export type EventStreamRendererOptions = {
  colors?: boolean;
  maxToolOutputLength?: number;
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
  | "context"
  | "muted";

export type RenderedAgentEvent = {
  kind: RenderedAgentEventKind;
  text: string;
};

export class EventStreamRenderer {
  private pendingText = "";
  private pendingThinking = "";
  private lastRenderedAssistantText = "";
  private readonly colors: boolean;
  private readonly maxToolOutputLength: number;

  constructor(options: EventStreamRendererOptions = {}) {
    this.colors = options.colors ?? true;
    this.maxToolOutputLength = options.maxToolOutputLength ?? 120;
  }

  render(event: AgentEvent): string {
    return this.renderEvent(event)
      .map((item) => item.text)
      .join("\n");
  }

  renderEvent(event: AgentEvent): RenderedAgentEvent[] {
    if (event.type === "assistant.delta") {
      if (event.channel === "thinking") {
        this.pendingThinking += event.text;
        return [];
      }

      this.pendingText += event.text;
      return [];
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
        return { kind: "diff", text: this.magenta(renderChangeSetLines(event.changeSet).join("\n")) };
      case "context.budget":
        return { kind: "context", text: formatContextBudget(event.usedTokens, event.maxTokens, event.ratio, event.compactAtRatio) };
      case "context.compacted":
        return { kind: "warning", text: this.yellow(`context compacted ${event.originalTokens} -> ${event.compactedTokens} tokens`) };
      case "verification.started":
        return { kind: "tool", text: this.gray(event.command) };
      case "verification.finished":
        return event.exitCode === 0 ? { kind: "success", text: this.green(event.command) } : { kind: "error", text: this.red(event.command) };
      case "task.finished":
        return this.renderTaskFinished(event.summary);
      case "task.failed":
        return { kind: "error", text: this.red(`${event.error.code} ${event.error.message}`) };
    }
  }

  private formatToolOutput(output: string): string {
    return truncate(compactInline(output), this.maxToolOutputLength);
  }

  private renderTaskFinished(summary: string): RenderedAgentEvent {
    const text = renderMarkdownText(summary, { colors: this.colors });
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
}

function compactInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeRenderedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
