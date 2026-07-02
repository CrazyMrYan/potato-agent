import type { AgentEvent } from "@coding-agent/protocol";
import pc from "picocolors";

export type EventStreamRendererOptions = {
  colors?: boolean;
  maxToolOutputLength?: number;
};

export class EventStreamRenderer {
  private pendingText = "";
  private pendingThinking = "";
  private readonly colors: boolean;
  private readonly maxToolOutputLength: number;

  constructor(options: EventStreamRendererOptions = {}) {
    this.colors = options.colors ?? true;
    this.maxToolOutputLength = options.maxToolOutputLength ?? 120;
  }

  render(event: AgentEvent): string {
    if (event.type === "assistant.delta") {
      if (event.channel === "thinking") {
        this.pendingThinking += event.text;
        return "";
      }

      this.pendingText += event.text;
      return "";
    }

    const flushed = this.flush();
    const current = this.renderImmediate(event);

    if (flushed && current) {
      return `${flushed}\n${current}`;
    }

    return flushed || current;
  }

  flush(): string {
    const lines: string[] = [];

    if (this.pendingThinking.trim()) {
      lines.push(this.dim(`推理：${compactInline(this.pendingThinking)}`));
      this.pendingThinking = "";
    }

    if (this.pendingText.trim()) {
      lines.push(this.pendingText.trim());
      this.pendingText = "";
    }

    return lines.join("\n");
  }

  private renderImmediate(event: Exclude<AgentEvent, { type: "assistant.delta" }>): string {
    switch (event.type) {
      case "task.started":
        return this.cyan(`收到任务：${event.prompt}`);
      case "step.started":
        return this.blue(`步骤：${event.title}`);
      case "tool.started":
        return this.gray(`工具开始：${event.tool} - ${event.summary}`);
      case "tool.finished":
        return event.success
          ? this.green(`工具完成：${event.tool}${event.output ? ` - ${this.formatToolOutput(event.output)}` : ""}`)
          : this.red(`工具失败：${event.tool}${event.output ? ` - ${this.formatToolOutput(event.output)}` : ""}`);
      case "approval.requested":
        return this.yellow(`需要确认：${event.request.title}`);
      case "diff.produced":
        return this.magenta(`产生 diff：${event.changeSet.files.length} 个文件`);
      case "verification.started":
        return this.gray(`开始验证：${event.command}`);
      case "verification.finished":
        return event.exitCode === 0 ? this.green(`验证通过：${event.command}`) : this.red(`验证失败：${event.command}`);
      case "task.finished":
        return event.summary;
      case "task.failed":
        return this.red(`任务失败：${event.error.code} ${event.error.message}`);
    }
  }

  private formatToolOutput(output: string): string {
    return truncate(compactInline(output), this.maxToolOutputLength);
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

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
