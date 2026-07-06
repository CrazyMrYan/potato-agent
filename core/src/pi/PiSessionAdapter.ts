import type { AgentEvent } from "@potato/protocol";
import { RpcClient, type RpcClientOptions, type RpcExtensionUIResponse } from "@earendil-works/pi-coding-agent";
import { buildPiRpcArgs } from "../config/AgentConfig.js";
import { PiEventMapper, type RawPiEvent } from "./PiEventMapper.js";
import type { PiAdapterOptions } from "./PiAdapter.js";
import { resolvePiCliPath } from "./resolvePiCliPath.js";

export type PiSessionAdapter = {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(prompt: string): AsyncIterable<AgentEvent>;
  respondToApproval?(requestId: string, approved: boolean): Promise<void>;
};

type PiSessionAdapterDependencies = {
  createClient?: (options: RpcClientOptions) => PiSessionClientLike;
};

export type PiSessionClientLike = {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: (event: unknown) => void): () => void;
  prompt(message: string): Promise<void>;
  waitForIdle(timeout?: number): Promise<void>;
  getLastAssistantText(): Promise<string | null>;
  getStderr(): string;
  respondToExtensionUi?(response: RpcExtensionUIResponse): Promise<void>;
};

export class PiRpcSessionAdapter implements PiSessionAdapter {
  private client?: PiSessionClientLike;

  constructor(
    private readonly options: PiAdapterOptions,
    private readonly dependencies: PiSessionAdapterDependencies = {}
  ) {}

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    const client = this.createClient({
      cliPath: resolvePiCliPath(),
      cwd: this.options.workspacePath,
      env: { [this.options.apiKeyEnvName]: this.options.apiKey },
      provider: this.options.provider,
      model: this.options.model,
      args: buildPiRpcArgs(this.options)
    });

    await client.start();
    this.client = client;
  }

  async stop(): Promise<void> {
    await this.client?.stop();
    this.client = undefined;
  }

  async respondToApproval(requestId: string, approved: boolean): Promise<void> {
    await sendExtensionUiResponse(this.requireClient(), {
      type: "extension_ui_response",
      id: requestId,
      confirmed: approved
    });
  }

  async *send(prompt: string): AsyncIterable<AgentEvent> {
    const client = this.requireClient();
    const taskId = `turn_${Date.now()}`;
    const stream = new AsyncEventQueue<AgentEvent>();
    const mapper = new PiEventMapper(taskId);
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
        await client.prompt(prompt);
        await client.waitForIdle(this.options.timeoutMs ?? 120_000);
        const summary = await resolveFinalSummary(client, sawAssistantText);
        if (summary.type === "failed") {
          stream.push(summary.event(taskId));
          return;
        }
        stream.push({ type: "task.finished", taskId, summary: summary.summary });
      } catch (error) {
        stream.push({
          type: "task.failed",
          taskId,
          error: {
            code: "PI_INIT_FAILED",
            message: error instanceof Error ? error.message : String(error),
            cause: client.getStderr() || undefined
          }
        });
      } finally {
        unsubscribe();
        stream.close();
      }
    })();

    for await (const event of stream) {
      yield event;
    }

    await task;
  }

  private createClient(options: RpcClientOptions): PiSessionClientLike {
    return this.dependencies.createClient?.(options) ?? new RpcClient(options);
  }

  private requireClient(): PiSessionClientLike {
    if (!this.client) {
      throw new Error("Pi 会话尚未启动。");
    }

    return this.client;
  }
}

function resolveFinalSummary(
  client: PiSessionClientLike,
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

async function sendExtensionUiResponse(client: PiSessionClientLike, response: RpcExtensionUIResponse): Promise<void> {
  if (client.respondToExtensionUi) {
    await client.respondToExtensionUi(response);
    return;
  }

  const process = (client as unknown as { process?: { stdin?: { write?: (chunk: string) => void; destroyed?: boolean; writable?: boolean } } }).process;
  const stdin = process?.stdin;
  if (!stdin?.write || stdin.destroyed || stdin.writable === false) {
    throw new Error("Pi RPC client does not expose a writable extension UI response channel.");
  }

  stdin.write(`${JSON.stringify(response)}\n`);
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
