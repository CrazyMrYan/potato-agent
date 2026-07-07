import type { AgentEvent, RunTaskInput } from "@potato/protocol";
import { RpcClient, type RpcClientOptions } from "@earendil-works/pi-coding-agent";
import { buildPiRpcArgs } from "../config/AgentConfig.js";
import { PiEventMapper, type RawPiEvent } from "./PiEventMapper.js";
import { buildPiProcessEnv } from "./buildPiProcessEnv.js";
import type { PiAdapter, PiAdapterOptions, PiAdapterRunOptions } from "./PiAdapter.js";
import { resolvePiCliPath } from "./resolvePiCliPath.js";

export type PiRpcClientLike = {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: (event: unknown) => void): () => void;
  prompt(message: string): Promise<void>;
  waitForIdle(timeout?: number): Promise<void>;
  getLastAssistantText(): Promise<string | null>;
  getStderr(): string;
};

type PiRpcAdapterDependencies = {
  createClient?: (options: RpcClientOptions) => PiRpcClientLike;
};

export class PiRpcAdapter implements PiAdapter {
  constructor(
    private readonly options: PiAdapterOptions,
    private readonly dependencies: PiRpcAdapterDependencies = {}
  ) {}

  async *run(input: RunTaskInput, options: PiAdapterRunOptions = {}): AsyncIterable<AgentEvent> {
    const client = this.createClient({
      cliPath: this.resolveCliPath(),
      cwd: this.options.workspacePath,
      env: buildPiProcessEnv(this.options.apiKeyEnvName, this.options.apiKey),
      provider: this.options.provider,
      model: this.options.model,
      args: buildPiRpcArgs(this.options)
    });
    let aborted = options.signal?.aborted ?? false;
    const abort = () => {
      aborted = true;
      void client.stop();
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      if (aborted) {
        yield cancelledEvent(input.taskId);
        return;
      }
      yield {
        type: "step.started",
        taskId: input.taskId,
        title: `启动 Pi RPC：${this.options.provider}/${this.options.model}`
      };

      await client.start();
      if (aborted) {
        yield cancelledEvent(input.taskId);
        return;
      }
      const stream = new AsyncEventQueue<AgentEvent>();
      const mapper = new PiEventMapper(input.taskId);
      let sawAssistantText = false;
      const unsubscribe = client.onEvent((event) => {
        for (const mapped of mapper.map(event as RawPiEvent)) {
          if (mapped.type === "assistant.delta" && mapped.channel === "text" && mapped.text.trim()) {
            sawAssistantText = true;
          }
          stream.push(mapped);
        }
      });

      const task = (async () => {
        try {
          await client.prompt(input.prompt);
          await client.waitForIdle();
          if (aborted) {
            stream.push(cancelledEvent(input.taskId));
            return;
          }
          const summary = await resolveFinalSummary(client, sawAssistantText);
          if (summary.type === "failed") {
            stream.push(summary.event(input.taskId));
            return;
          }
          stream.push({ type: "task.finished", taskId: input.taskId, summary: summary.summary });
        } catch (error) {
          stream.push(aborted ? cancelledEvent(input.taskId) : this.toFailedEvent(input.taskId, client, error));
        } finally {
          unsubscribe();
          stream.close();
        }
      })();

      for await (const event of stream) {
        yield event;
      }

      await task;
    } catch (error) {
      yield aborted ? cancelledEvent(input.taskId) : this.toFailedEvent(input.taskId, client, error);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      await client.stop();
    }
  }

  private createClient(options: RpcClientOptions): PiRpcClientLike {
    return this.dependencies.createClient?.(options) ?? new RpcClient(options);
  }

  private resolveCliPath(): string {
    return resolvePiCliPath();
  }

  private toFailedEvent(taskId: string, client: PiRpcClientLike, error: unknown): AgentEvent {
    return {
      type: "task.failed",
      taskId,
      error: {
        code: "PI_INIT_FAILED",
        message: this.formatError(error),
        cause: client.getStderr() || undefined
      }
    };
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

function cancelledEvent(taskId: string): AgentEvent {
  return {
    type: "task.failed",
    taskId,
    error: {
      code: "TASK_CANCELLED",
      message: "Task cancelled by user."
    }
  };
}

function resolveFinalSummary(
  client: PiRpcClientLike,
  sawAssistantText: boolean
): Promise<{ type: "finished"; summary: string } | { type: "failed"; event: (taskId: string) => AgentEvent }> {
  return client.getLastAssistantText().then((summary) => {
    if (summary !== null) {
      return { type: "finished", summary };
    }

    if (sawAssistantText) {
      return { type: "finished", summary: "" };
    }

    const stderr = client.getStderr().trim();
    if (stderr) {
      return {
        type: "failed",
        event: (taskId: string) => ({
          type: "task.failed",
          taskId,
          error: {
            code: "PI_EMPTY_RESPONSE",
            message: firstLine(stderr),
            cause: stderr
          }
        })
      };
    }

    return { type: "finished", summary: "Pi 运行完成，但没有返回最终文本。" };
  });
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? value;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }

    this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          const value = this.values.shift() as T;
          return Promise.resolve({ value, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }

        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    };
  }
}
