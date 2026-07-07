# Control Verification Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the next core batch around user control, post-task verification, runtime diagnostics, resumable sessions, and context compaction correctness.

**Architecture:** Keep Pi RPC as the default execution path. Cancellation must interrupt the concrete RPC client, not just set UI state or an unused abort flag. Verification must run on both execution paths in this repo: one-shot `AgentLoop.run()` and interactive `AgentSession.send()`, because the TUI uses the session path. Treat cancellation, verification, config validation, and session metadata as traceable runtime state rather than display-only UI features.

**Tech Stack:** TypeScript, Node.js built-ins, pnpm workspace, Vitest, Ink, existing `@potato/protocol`, `@potato/core`, and `@potato/cli` packages.

---

## File Structure

- Modify `protocol/src/errors.ts`: confirm `TASK_CANCELLED` remains a stable error code and reuse it for cancellation.
- Modify `protocol/src/events.ts`: keep cancellation represented as `task.failed` with `error.code = "TASK_CANCELLED"`; do not add a separate event unless tests prove consumers need it.
- Modify `core/src/pi/PiAdapter.ts`: pass an optional `AbortSignal` into one-shot adapter runs.
- Modify `core/src/pi/PiRpcAdapter.ts`: wire the abort signal to `client.stop()` so cancellation interrupts the active RPC process.
- Modify `core/src/pi/PiSessionAdapter.ts`: add `cancelCurrentTask?()` to session adapters and implement it for Pi RPC by calling `stop()`.
- Modify `core/src/session/AgentSession.ts`: add `cancelCurrentTask()`, trace cancellation, and make `send()` stop yielding after cancellation.
- Modify `core/src/orchestrator/AgentOrchestrator.ts`: track active loop runs by task id and implement `cancel(taskId)`.
- Modify `core/src/loop/AgentLoop.ts`: accept an abort signal, pass it to the adapter, and emit `TASK_CANCELLED` when cancellation wins.
- Create `core/src/verification/VerificationRunner.ts`: run explicit or detected verification commands.
- Modify `core/src/config/AgentConfig.ts`: add `verification?: AgentVerificationConfig`.
- Modify `core/src/session/AgentSessionFactory.ts`: pass verification dependencies and session metadata dependencies into sessions.
- Create `core/src/config/ConfigValidator.ts`: validate provider/model/API key/workspace/adapter/permission state.
- Create `core/src/session/SessionMetadataStore.ts`: persist session metadata under `.potato/sessions`; this batch lists resumable sessions but does not restore live Pi process state.
- Modify `cli/src/ui/EventStreamRenderer.ts`: render cancellation and richer verification results.
- Modify `cli/src/ui/AgentTui.tsx`: add `/cancel`, busy-safe cancel shortcut behavior, `/status`, `/resume`, verification progress display, and config status display.
- Modify `cli/src/commands/tui.tsx`: create and inject `SessionMetadataStore` and validator where needed.
- Modify `core/src/context/ContextBudget.ts`: separate heuristic budget estimate from real compaction summary state.
- Modify `wiki/project-state.md`: document the new runtime control and verification status.

---

## Task 1: Cancellation Protocol, Adapter Interruption, and Core Semantics

**Files:**
- Modify: `protocol/src/errors.ts`
- Modify: `core/src/pi/PiAdapter.ts`
- Modify: `core/src/pi/PiRpcAdapter.ts`
- Modify: `core/src/pi/PiSessionAdapter.ts`
- Modify: `core/src/session/AgentSession.ts`
- Modify: `core/src/orchestrator/AgentOrchestrator.ts`
- Test: `core/tests/agent-session-factory.test.ts`
- Test: `core/tests/orchestrator.test.ts`
- Test: `core/tests/pi-rpc-streaming.test.ts`

- [ ] **Step 1: Write failing session cancellation test**

Add this test to `core/tests/agent-session-factory.test.ts`:

```ts
it("cancels the active session task, stops the adapter, and records TASK_CANCELLED", async () => {
  const adapter = new FakeSessionAdapter();
  const traceStore = new MemoryTraceStore();
  let releaseSend: (() => void) | undefined;
  adapter.send = async function* (prompt: string) {
    this.prompts.push(prompt);
    yield { type: "step.started" as const, taskId: "turn_1", title: "working" };
    await new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    yield { type: "task.finished" as const, taskId: "turn_1", summary: "should not finish" };
  };

  const factory = new AgentSessionFactory({
    createAdapter: () => adapter,
    createTraceStore: () => traceStore,
    env: { DEEPSEEK_API_KEY: "test-key" }
  });
  const session = await factory.create({
    provider: "deepseek",
    model: "deepseek-reasoner",
    workspacePath: "/repo"
  });

  const events: AgentEvent[] = [];
  const consume = (async () => {
    for await (const event of session.send("long task")) {
      events.push(event);
      if (event.type === "step.started") {
        await session.cancelCurrentTask();
        releaseSend?.();
      }
    }
  })();

  await consume;

  expect(adapter.stopped).toBe(true);
  expect(events.at(-1)).toEqual({
    type: "task.failed",
    taskId: "turn_1",
    error: { code: "TASK_CANCELLED", message: "Task cancelled by user." }
  });
  expect(traceStore.entries).toContainEqual(
    expect.objectContaining({ kind: "task.failed", code: "TASK_CANCELLED", message: "Task cancelled by user." })
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @potato/core test -- agent-session-factory
```

Expected: FAIL because `AgentSession.cancelCurrentTask()` does not exist.

- [ ] **Step 3: Add one-shot adapter abort surface**

Modify `core/src/pi/PiAdapter.ts`:

```ts
export type PiAdapterRunOptions = {
  signal?: AbortSignal;
};

export interface PiAdapter {
  run(input: RunTaskInput, options?: PiAdapterRunOptions): AsyncIterable<PiAdapterEvent>;
}
```

Update all `PiAdapter` implementations and test fakes to accept the optional second argument. Fakes can ignore it:

```ts
async *run(task: RunTaskInput, _options: PiAdapterRunOptions = {}): AsyncIterable<AgentEvent> {
  yield { type: "step.started", taskId: task.taskId, title: "work" };
  yield { type: "task.finished", taskId: task.taskId, summary: "done" };
}
```

- [ ] **Step 4: Wire `PiRpcAdapter` abort to the RPC client**

Modify `core/src/pi/PiRpcAdapter.ts` so `run(input, options)` stops the active client when the signal aborts. The existing queue/prompt/wait/final-summary flow stays in place, but the task body must race against cancellation:

```ts
async *run(input: RunTaskInput, options: PiAdapterRunOptions = {}): AsyncIterable<AgentEvent> {
  const client = this.createClient({
    cliPath: this.resolveCliPath(),
    cwd: this.options.workspacePath,
    env: buildPiProcessEnv(this.options.apiKeyEnvName, this.options.apiKey),
    provider: this.options.provider,
    model: this.options.model,
    args: buildPiRpcArgs(this.options)
  });

  let aborted = false;
  const abort = () => {
    aborted = true;
    void client.stop();
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    yield {
      type: "step.started",
      taskId: input.taskId,
      title: `启动 Pi RPC：${this.options.provider}/${this.options.model}`
    };

    await client.start();
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
        await client.waitForIdle(this.options.timeoutMs ?? 120_000);
        if (aborted) {
          stream.push(cancelledEvent(input.taskId));
          return;
        }
        const summary = await resolveFinalSummary(client, sawAssistantText);
        stream.push(summary.type === "failed" ? summary.event(input.taskId) : { type: "task.finished", taskId: input.taskId, summary: summary.summary });
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
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await client.stop();
  }
}

function cancelledEvent(taskId: string): AgentEvent {
  return {
    type: "task.failed",
    taskId,
    error: { code: "TASK_CANCELLED", message: "Task cancelled by user." }
  };
}
```

If abort fires before `client.start()` completes, catch the startup error and yield `cancelledEvent(input.taskId)`:

```ts
} catch (error) {
  if (aborted) {
    yield cancelledEvent(input.taskId);
    return;
  }
  yield this.toFailedEvent(input.taskId, client, error);
}
```

- [ ] **Step 5: Add session adapter cancellation surface**

Modify `core/src/pi/PiSessionAdapter.ts`:

```ts
export type PiSessionAdapter = {
  readonly name?: "rpc" | "runtime" | "sdk";
  start(): Promise<void>;
  stop(): Promise<void>;
  send(prompt: string): AsyncIterable<AgentEvent>;
  cancelCurrentTask?(): Promise<void>;
  respondToApproval?(requestId: string, approved: boolean): Promise<void>;
  compact?(customInstructions?: string): Promise<{ summary: string; originalTokens?: number; compactedTokens?: number }>;
};
```

Implement on `PiRpcSessionAdapter`:

```ts
async cancelCurrentTask(): Promise<void> {
  await this.stop();
}
```

- [ ] **Step 6: Implement `AgentSession.cancelCurrentTask()`**

Add private state and method in `core/src/session/AgentSession.ts`:

```ts
private activeTaskId?: string;
private cancelledTaskIds = new Set<string>();

async cancelCurrentTask(): Promise<void> {
  const taskId = this.activeTaskId;
  if (taskId) {
    this.cancelledTaskIds.add(taskId);
  }
  if (this.adapter.cancelCurrentTask) {
    await this.adapter.cancelCurrentTask();
  } else {
    await this.adapter.stop();
  }
}
```

In `send()`, set `this.activeTaskId` from the first event, and when cancellation is observed, emit:

```ts
const cancelled: AgentEvent = {
  type: "task.failed",
  taskId: input.taskId,
  error: { code: "TASK_CANCELLED", message: "Task cancelled by user." }
};
await this.trace({
  timestamp: nowIso(),
  taskId: input.taskId,
  kind: "task.failed",
  code: cancelled.error.code,
  message: cancelled.error.message
});
yield cancelled;
return;
```

Clear `activeTaskId` in a `finally` block when the task completes. If the underlying adapter stops and `send()` throws after cancellation, catch that error and emit the same `TASK_CANCELLED` event instead of surfacing adapter shutdown text to the user.

- [ ] **Step 7: Implement one-shot orchestrator cancellation**

Add a map to `core/src/orchestrator/AgentOrchestrator.ts`:

```ts
private readonly activeRuns = new Map<string, AbortController>();
```

In `run(input)`, create and store an `AbortController`, pass `signal` into `AgentLoop` through dependencies, and delete it in `finally`.

Implement:

```ts
async cancel(taskId: string): Promise<void> {
  this.activeRuns.get(taskId)?.abort();
}
```

- [ ] **Step 8: Make `AgentLoop` pass abort to the adapter and emit cancellation**

Extend `AgentLoopDependencies`:

```ts
abortSignal?: AbortSignal;
```

Pass the signal into the adapter:

```ts
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
```

Add a private helper:

```ts
private async *cancelled(taskId: string): AsyncIterable<AgentEvent> {
  const cancelled: TaskFailedEvent = {
    type: "task.failed",
    taskId,
    error: { code: "TASK_CANCELLED", message: "Task cancelled by user." }
  };
  await this.traceEvent(cancelled);
  await this.trace({ timestamp: nowIso(), taskId, kind: "task.failed", code: "TASK_CANCELLED", message: "Task cancelled by user." });
  yield cancelled;
}
```

- [ ] **Step 9: Add `PiRpcAdapter` abort test**

Add a test to `core/tests/pi-rpc-streaming.test.ts` using the existing fake RPC client pattern. The fake client must expose `stop = vi.fn(async () => {})`, delay `waitForIdle`, abort the signal after the first event, and assert `stop` was called and the yielded final event has `error.code = "TASK_CANCELLED"`.

- [ ] **Step 10: Run core cancellation tests**

Run:

```bash
pnpm --filter @potato/core test -- agent-session-factory orchestrator pi-rpc-streaming
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add protocol/src/errors.ts core/src/pi core/src/session core/src/orchestrator core/src/loop core/tests
git commit -m "feat: add task cancellation semantics"
```

---

## Task 2: TUI Cancel Command and Busy-Safe Shortcut Behavior

**Files:**
- Modify: `cli/src/ui/AgentTui.tsx`
- Modify: `cli/src/ui/EventStreamRenderer.ts`
- Test: `cli/tests/tui-render.test.ts`

- [ ] **Step 1: Write failing TUI cancellation tests**

Add this test to `cli/tests/tui-render.test.ts`:

```ts
it("cancels a running task with Ctrl+C and shows the cancelled state", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
  let releaseFinish: (() => void) | undefined;
  const stop = vi.fn(async () => {});
  const cancelCurrentTask = vi.fn(async () => {});
  const rendered = render(
    React.createElement(AgentTui, {
      config: { workspacePath, provider: "deepseek", model: "deepseek-reasoner" },
      createSession: () => ({
        async start() {},
        stop,
        cancelCurrentTask,
        async *send() {
          yield { type: "step.started" as const, taskId: "task_1", title: "working" };
          await new Promise<void>((resolve) => {
            releaseFinish = resolve;
          });
          yield { type: "task.failed" as const, taskId: "task_1", error: { code: "TASK_CANCELLED", message: "Task cancelled by user." } };
        },
        async approve() {}
      })
    })
  );

  rendered.stdin.write("long task");
  await new Promise((resolve) => setTimeout(resolve, 0));
  rendered.stdin.write("\r");
  await waitForFrame(rendered.lastFrame, "状态：运行中");

  rendered.stdin.write("\u0003");
  releaseFinish?.();

  await waitForFrame(rendered.lastFrame, "任务已取消");
  expect(cancelCurrentTask).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run TUI test and verify it fails**

Run:

```bash
pnpm --filter @potato/cli test -- tui-render
```

Expected: FAIL because Ctrl+C currently exits the TUI instead of cancelling a busy task.

- [ ] **Step 3: Add `/cancel` command option**

Modify `commandOptions` in `cli/src/ui/AgentTui.tsx`:

```ts
{ command: "/cancel", label: "/cancel", description: "取消当前任务" },
```

- [ ] **Step 4: Wire cancellation to active session**

Replace the body of `pauseActiveTask` with cancellation-first behavior:

```ts
if (pendingApproval) {
  await respondToApproval(false);
  return;
}

if (!sessionRef.current || !busy) {
  appendEvent({ kind: "muted", text: "当前没有正在运行的任务。" });
  return;
}

try {
  const session = sessionRef.current as AgentSession & { cancelCurrentTask?: () => Promise<void> };
  if (session.cancelCurrentTask) {
    await session.cancelCurrentTask();
  } else {
    await session.stop();
  }
  sessionRef.current = undefined;
  setBusy(false);
  setPendingApproval(undefined);
  setMode("chat");
  appendEvent({ kind: "warning", text: "任务已取消。" });
} catch (error) {
  appendEvent({ kind: "error", text: `取消失败：${error instanceof Error ? error.message : String(error)}` });
}
```

Add in `handlePrompt()` so `/cancel` works when the prompt line is available:

```ts
if (prompt === "/cancel") {
  await pauseActiveTask();
  return;
}
```

Modify the existing Ctrl+C input branch in `useInput()`:

```ts
if (key.ctrl && input === "c") {
  if (busy) {
    void pauseActiveTask();
    return;
  }
  void sessionRef.current?.stop();
  app.exit();
  return;
}
```

Keep the existing Ctrl+P path as an alias for pause/cancel:

```ts
if (key.ctrl && input === "p") {
  void pauseActiveTask();
  return;
}
```

- [ ] **Step 5: Render cancellation cleanly**

Modify `cli/src/ui/EventStreamRenderer.ts` in the `task.failed` branch:

```ts
if (event.error.code === "TASK_CANCELLED") {
  return { kind: "warning", text: this.yellow("任务已取消。") };
}
```

- [ ] **Step 6: Run TUI tests**

Run:

```bash
pnpm --filter @potato/cli test -- tui-render stream-renderer
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/ui cli/tests
git commit -m "feat: add tui task cancellation"
```

---

## Task 3: Verification Runner Core

**Files:**
- Create: `core/src/verification/VerificationRunner.ts`
- Modify: `core/src/config/AgentConfig.ts`
- Modify: `core/src/loop/AgentLoop.ts`
- Modify: `core/src/session/AgentSession.ts`
- Modify: `core/src/session/AgentSessionFactory.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/verification-runner.test.ts`
- Test: `core/tests/agent-loop.test.ts`

- [ ] **Step 1: Write failing runner tests**

Create `core/tests/verification-runner.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VerificationRunner } from "../src/verification/VerificationRunner.js";

describe("VerificationRunner", () => {
  it("runs an explicit verification command", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "potato-verify-"));
    const runner = new VerificationRunner({
      execFile: async (file, args) => ({
        exitCode: 0,
        output: `${file} ${args.join(" ")}`
      })
    });

    await expect(runner.run({ workspacePath: workspace, command: "pnpm test" })).resolves.toEqual({
      command: "pnpm test",
      exitCode: 0,
      output: "pnpm test"
    });
  });

  it("detects pnpm test from package.json scripts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "potato-verify-"));
    await writeFile(join(workspace, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
    const runner = new VerificationRunner({
      execFile: async (file, args) => ({ exitCode: 0, output: `${file} ${args.join(" ")}` })
    });

    await expect(runner.detect(workspace)).resolves.toBe("pnpm test");
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
pnpm --filter @potato/core test -- verification-runner
```

Expected: FAIL because `VerificationRunner` does not exist.

- [ ] **Step 3: Add verification config type**

Modify `core/src/config/AgentConfig.ts`:

```ts
export type AgentVerificationConfig = {
  enabled?: boolean;
  command?: string;
  autoDetect?: boolean;
  timeoutMs?: number;
};

export type AgentConfig = {
  // existing fields
  verification?: AgentVerificationConfig;
};
```

- [ ] **Step 4: Implement `VerificationRunner`**

Create `core/src/verification/VerificationRunner.ts`:

```ts
import { execFile as nodeExecFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(nodeExecFile);

export type VerificationResult = {
  command: string;
  exitCode: number;
  output: string;
};

export type VerificationRunnerDependencies = {
  execFile?: (file: string, args: string[], options: { cwd: string; timeout?: number }) => Promise<{ exitCode: number; output: string }>;
};

export class VerificationRunner {
  constructor(private readonly dependencies: VerificationRunnerDependencies = {}) {}

  async detect(workspacePath: string): Promise<string | undefined> {
    try {
      const pkg = JSON.parse(await readFile(join(workspacePath, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test) return "pnpm test";
      if (pkg.scripts?.check) return "pnpm check";
      if (pkg.scripts?.build) return "pnpm build";
      return undefined;
    } catch {
      return undefined;
    }
  }

  async run(input: { workspacePath: string; command: string; timeoutMs?: number }): Promise<VerificationResult> {
    const [file, ...args] = splitCommand(input.command);
    const execFile = this.dependencies.execFile ?? defaultExecFile;
    return { command: input.command, ...(await execFile(file, args, { cwd: input.workspacePath, timeout: input.timeoutMs })) };
  }
}

function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

async function defaultExecFile(file: string, args: string[], options: { cwd: string; timeout?: number }): Promise<{ exitCode: number; output: string }> {
  try {
    const result = await execFileAsync(file, args, { cwd: options.cwd, timeout: options.timeout, encoding: "utf8" });
    return { exitCode: 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? failure.message ?? ""}`
    };
  }
}
```

- [ ] **Step 5: Export runner**

Modify `core/src/index.ts`:

```ts
export { VerificationRunner, runVerificationEvents } from "./verification/VerificationRunner.js";
export type { VerificationResult, VerificationRunnerDependencies } from "./verification/VerificationRunner.js";
```

- [ ] **Step 6: Add a shared verification event helper**

In `core/src/verification/VerificationRunner.ts`, add a helper that turns verification into protocol events:

```ts
import type { AgentEvent } from "@potato/protocol";
import type { AgentVerificationConfig } from "../config/AgentConfig.js";

export async function* runVerificationEvents(input: {
  taskId: string;
  workspacePath: string;
  config?: AgentVerificationConfig;
  runner?: Pick<VerificationRunner, "detect" | "run">;
}): AsyncIterable<AgentEvent> {
  const verification = input.config;
  const runner = input.runner;
  if (verification?.enabled === false || !runner) return;

  const command = verification?.command ?? (verification?.autoDetect === false ? undefined : await runner.detect(input.workspacePath));
  if (!command) return;

  yield { type: "verification.started", taskId: input.taskId, command };
  const result = await runner.run({ workspacePath: input.workspacePath, command, timeoutMs: verification?.timeoutMs });
  yield {
    type: "verification.finished",
    taskId: input.taskId,
    command: result.command,
    exitCode: result.exitCode,
    output: result.output
  };
}
```

- [ ] **Step 7: Wire verification into `AgentLoop`**

Extend `AgentLoopDependencies`:

```ts
verificationRunner?: VerificationRunner;
verification?: AgentVerificationConfig;
```

After diff emission and before final `task.finished`, run verification when final event is successful:

```ts
if (finalEvent?.type === "task.finished") {
  for await (const event of runVerificationEvents({
    taskId: input.taskId,
    workspacePath: input.workspacePath,
    config: this.dependencies.verification,
    runner: this.dependencies.verificationRunner
  })) {
    await this.traceEvent(event);
    yield event;
  }
}
```

- [ ] **Step 8: Wire verification into `AgentSession`**

Add verification dependencies to `AgentSession`:

```ts
private readonly verificationRunner?: VerificationRunner,
private readonly verification?: AgentVerificationConfig
```

When `AgentSession.send()` receives `task.finished`, yield verification events before yielding the final task event:

```ts
if (event.type === "task.finished" && input) {
  this.contextBudget?.record?.(input, event.summary);
  for await (const verificationEvent of runVerificationEvents({
    taskId: event.taskId,
    workspacePath: this.workspacePath,
    config: this.verification,
    runner: this.verificationRunner
  })) {
    await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "event", event: verificationEvent });
    yield verificationEvent;
  }
  await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "task.finished", summary: event.summary });
}
```

Avoid recording `contextBudget.record()` twice when moving this block.

- [ ] **Step 9: Pass verification dependencies from `AgentSessionFactory`**

Extend `AgentSessionFactoryDependencies`:

```ts
createVerificationRunner?: () => VerificationRunner;
```

When creating the session:

```ts
const verificationRunner = this.dependencies.createVerificationRunner?.() ?? new VerificationRunner();
return new AgentSession(adapter, traceStore, workspacePath, activeSubAgent, contextBudget, verificationRunner, resolved.verification);
```

- [ ] **Step 10: Add loop integration test**

Add to `core/tests/agent-loop.test.ts`:

```ts
it("runs verification after diff and before task.finished", async () => {
  const loop = new AgentLoop(new StaticAdapter(), {
    diffService: new StaticDiffService({ files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] }),
    verification: { enabled: true, command: "pnpm test" },
    verificationRunner: {
      detect: async () => undefined,
      run: async () => ({ command: "pnpm test", exitCode: 0, output: "pass" })
    } as VerificationRunner
  });
  const events: AgentEvent[] = [];

  for await (const event of loop.run(input())) {
    events.push(event);
  }

  expect(events.map((event) => event.type)).toEqual([
    "task.started",
    "step.started",
    "diff.produced",
    "verification.started",
    "verification.finished",
    "task.finished"
  ]);
});
```

- [ ] **Step 11: Add session integration test**

Add to `core/tests/agent-session-factory.test.ts`:

```ts
it("runs verification for interactive session turns before task.finished is yielded", async () => {
  const adapter = new FakeSessionAdapter();
  const factory = new AgentSessionFactory({
    createAdapter: () => adapter,
    createVerificationRunner: () => ({
      detect: async () => undefined,
      run: async () => ({ command: "pnpm test", exitCode: 0, output: "pass" })
    } as VerificationRunner),
    env: { DEEPSEEK_API_KEY: "test-key" }
  });
  const session = await factory.create({
    provider: "deepseek",
    model: "deepseek-reasoner",
    workspacePath: "/repo",
    verification: { enabled: true, command: "pnpm test" }
  });

  const events: AgentEvent[] = [];
  for await (const event of session.send("change code")) {
    events.push(event);
  }

  expect(events.map((event) => event.type)).toEqual([
    "context.budget",
    "verification.started",
    "verification.finished",
    "task.finished"
  ]);
});
```

- [ ] **Step 12: Run core verification tests**

Run:

```bash
pnpm --filter @potato/core test -- verification-runner agent-loop
```

Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add core/src/verification core/src/config core/src/loop core/src/session core/src/index.ts core/tests
git commit -m "feat: add verification runner"
```

---

## Task 4: TUI Verification Display

**Files:**
- Modify: `cli/src/ui/EventStreamRenderer.ts`
- Modify: `cli/src/ui/AgentTui.tsx`
- Test: `cli/tests/stream-renderer.test.ts`
- Test: `cli/tests/tui-render.test.ts`

- [ ] **Step 1: Add stream renderer tests**

Add to `cli/tests/stream-renderer.test.ts`:

```ts
it("renders verification progress and result", () => {
  const renderer = new EventStreamRenderer({ colors: false });

  expect(renderer.renderEvent({ type: "verification.started", taskId: "task_1", command: "pnpm test" })).toEqual([
    { kind: "muted", text: "verification started: pnpm test" }
  ]);
  expect(renderer.renderEvent({ type: "verification.finished", taskId: "task_1", command: "pnpm test", exitCode: 0, output: "pass" })).toEqual([
    { kind: "success", text: "verification passed: pnpm test" }
  ]);
  expect(renderer.renderEvent({ type: "verification.finished", taskId: "task_1", command: "pnpm test", exitCode: 1, output: "fail" })).toEqual([
    { kind: "error", text: "verification failed: pnpm test exit=1" },
    { kind: "tool", text: "fail" }
  ]);
});
```

- [ ] **Step 2: Implement renderer output**

Modify `EventStreamRenderer.renderSingleEvent()`:

```ts
case "verification.started":
  return { kind: "muted", text: this.dim(`verification started: ${event.command}`) };
case "verification.finished":
  if (event.exitCode === 0) {
    return { kind: "success", text: this.green(`verification passed: ${event.command}`) };
  }
  return [
    { kind: "error", text: this.red(`verification failed: ${event.command} exit=${event.exitCode}`) },
    { kind: "tool", text: this.formatToolOutput(event.output) }
  ];
```

If the function currently returns one event at a time, add a small helper that normalizes `RenderedAgentEvent | RenderedAgentEvent[]` into an array in `renderEvent()`.

- [ ] **Step 3: Add TUI integration test**

Add to `cli/tests/tui-render.test.ts`:

```ts
it("shows verification events from the active session", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
  const rendered = render(
    React.createElement(AgentTui, {
      config: { workspacePath, provider: "deepseek", model: "deepseek-reasoner" },
      createSession: () => ({
        async start() {},
        async stop() {},
        async *send() {
          yield { type: "verification.started" as const, taskId: "task_1", command: "pnpm test" };
          yield { type: "verification.finished" as const, taskId: "task_1", command: "pnpm test", exitCode: 0, output: "pass" };
          yield { type: "task.finished" as const, taskId: "task_1", summary: "done" };
        },
        async approve() {}
      })
    })
  );

  rendered.stdin.write("task");
  await new Promise((resolve) => setTimeout(resolve, 0));
  rendered.stdin.write("\r");

  await waitForFrame(rendered.lastFrame, "verification passed: pnpm test");
});
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
pnpm --filter @potato/cli test -- stream-renderer tui-render
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/ui cli/tests
git commit -m "feat: show verification in tui"
```

---

## Task 5: Config Validator and Runtime Status

**Files:**
- Create: `core/src/config/ConfigValidator.ts`
- Modify: `core/src/index.ts`
- Modify: `cli/src/ui/AgentTui.tsx`
- Test: `core/tests/config-validator.test.ts`
- Test: `cli/tests/tui-render.test.ts`

- [ ] **Step 1: Write config validator tests**

Create `core/tests/config-validator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConfigValidator } from "../src/config/ConfigValidator.js";

describe("ConfigValidator", () => {
  it("reports valid config with provider, model, api key, and workspace", async () => {
    const validator = new ConfigValidator({
      exists: async () => true,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    await expect(
      validator.validate({ provider: "deepseek", model: "deepseek-reasoner", workspacePath: "/repo" })
    ).resolves.toEqual({ ok: true, issues: [] });
  });

  it("reports missing api key and workspace", async () => {
    const validator = new ConfigValidator({ exists: async () => false, env: {} });

    await expect(
      validator.validate({ provider: "deepseek", model: "deepseek-reasoner", workspacePath: "/missing" })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        issues: expect.arrayContaining([
          expect.objectContaining({ severity: "error", code: "MISSING_API_KEY" }),
          { severity: "error", code: "WORKSPACE_NOT_FOUND", message: "Workspace does not exist: /missing" }
        ])
      })
    );
  });
});
```

- [ ] **Step 2: Implement validator**

Create `core/src/config/ConfigValidator.ts`:

```ts
import { access } from "node:fs/promises";
import type { AgentConfig } from "./AgentConfig.js";
import { resolvePiAdapterOptions } from "../pi/resolvePiAdapterOptions.js";

export type ConfigIssue = {
  severity: "error" | "warning";
  code: "MISSING_PROVIDER" | "MISSING_MODEL" | "MISSING_API_KEY" | "WORKSPACE_NOT_FOUND" | "UNKNOWN_PERMISSION_MODE";
  message: string;
};

export type ConfigValidationResult = {
  ok: boolean;
  issues: ConfigIssue[];
};

export type ConfigValidatorDependencies = {
  exists?: (path: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
};

export class ConfigValidator {
  constructor(private readonly dependencies: ConfigValidatorDependencies = {}) {}

  async validate(config: AgentConfig): Promise<ConfigValidationResult> {
    const issues: ConfigIssue[] = [];
    if (!config.provider) issues.push({ severity: "error", code: "MISSING_PROVIDER", message: "Missing provider." });
    if (!config.model) issues.push({ severity: "error", code: "MISSING_MODEL", message: "Missing model." });
    if (config.provider && config.model) {
      try {
        resolvePiAdapterOptions({ ...config, env: this.dependencies.env ?? process.env });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/API_KEY|api key|--api-key/i.test(message)) {
          issues.push({ severity: "error", code: "MISSING_API_KEY", message });
        } else {
          issues.push({ severity: "error", code: "MISSING_PROVIDER", message });
        }
      }
    }
    const workspacePath = config.workspacePath ?? process.cwd();
    if (!(await this.exists(workspacePath))) {
      issues.push({ severity: "error", code: "WORKSPACE_NOT_FOUND", message: `Workspace does not exist: ${workspacePath}` });
    }
    const mode = config.permissionPolicy?.mode;
    if (mode && !["confirm", "bypass", "readonly"].includes(mode)) {
      issues.push({ severity: "error", code: "UNKNOWN_PERMISSION_MODE", message: `Unknown permission mode: ${mode}` });
    }
    return { ok: !issues.some((issue) => issue.severity === "error"), issues };
  }
  private async exists(path: string): Promise<boolean> {
    if (this.dependencies.exists) return this.dependencies.exists(path);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 3: Export validator**

Modify `core/src/index.ts`:

```ts
export { ConfigValidator } from "./config/ConfigValidator.js";
export type { ConfigIssue, ConfigValidationResult, ConfigValidatorDependencies } from "./config/ConfigValidator.js";
```

- [ ] **Step 4: Add `/status` to TUI**

Modify `commandOptions`:

```ts
{ command: "/status", label: "/status", description: "显示当前运行时配置" },
```

Add a formatter in `AgentTui.tsx`:

```ts
function formatRuntimeStatus(config: AgentConfig, workspacePath: string): string {
  const adapter = config.adapter ?? "rpc";
  const provider = config.provider ?? "unknown";
  const model = config.model ?? "unknown";
  const permission = config.permissionPolicy?.mode ?? "confirm";
  return `status: ${adapter} | ${provider}/${model} | ${permission} | ${workspacePath}`;
}
```

Handle command:

```ts
if (prompt === "/status") {
  appendEvent({ kind: "muted", text: formatRuntimeStatus(config, workspacePath) });
  return;
}
```

- [ ] **Step 5: Show compact status bar**

Replace the right-side status line text with:

```tsx
<Text color={busy ? "yellow" : "gray"}>
  {`${formatModel(config)} | ${formatPermissionMode(permissionMode)} | ${formatAgentRunStatus(busy, loadingTick)}`}
</Text>
```

- [ ] **Step 6: Add TUI status test**

Add to `cli/tests/tui-render.test.ts`:

```ts
it("shows runtime status from /status", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
  const rendered = render(
    React.createElement(AgentTui, {
      config: { workspacePath, provider: "deepseek", model: "deepseek-reasoner", permissionPolicy: { mode: "readonly" } }
    })
  );

  rendered.stdin.write("/status");
  await new Promise((resolve) => setTimeout(resolve, 0));
  rendered.stdin.write("\r");

  await waitForFrame(rendered.lastFrame, "status: rpc | deepseek/deepseek-reasoner | readonly");
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @potato/core test -- config-validator
pnpm --filter @potato/cli test -- tui-render
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add core/src/config core/src/index.ts core/tests/config-validator.test.ts cli/src/ui cli/tests/tui-render.test.ts
git commit -m "feat: add config validation and runtime status"
```

---

## Task 6: Session Metadata Persistence and Resume List

This task intentionally stops at persisted metadata plus a `/resume` list. It does not restore a live Pi RPC process or replay historical context into a new session. Full resume requires a later task that defines how summaries, trace ids, provider/model config, and active workspace are loaded back into `AgentSessionFactory`.

**Files:**
- Create: `core/src/session/SessionMetadataStore.ts`
- Modify: `core/src/session/AgentSession.ts`
- Modify: `core/src/session/AgentSessionFactory.ts`
- Modify: `core/src/index.ts`
- Modify: `cli/src/ui/AgentTui.tsx`
- Test: `core/tests/session-metadata-store.test.ts`
- Test: `cli/tests/tui-render.test.ts`

- [ ] **Step 1: Write metadata store tests**

Create `core/tests/session-metadata-store.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionMetadataStore } from "../src/session/SessionMetadataStore.js";

describe("SessionMetadataStore", () => {
  it("saves and lists sessions from newest to oldest", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "potato-session-"));
    const store = new SessionMetadataStore(workspace);

    await store.save({ sessionId: "old", provider: "deepseek", model: "deepseek-chat", workspacePath: workspace, updatedAt: "2026-07-07T00:00:00.000Z" });
    await store.save({ sessionId: "new", provider: "openai", model: "gpt-5", workspacePath: workspace, updatedAt: "2026-07-07T00:00:01.000Z" });

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ sessionId: "new" }),
      expect.objectContaining({ sessionId: "old" })
    ]);
  });
});
```

- [ ] **Step 2: Implement metadata store**

Create `core/src/session/SessionMetadataStore.ts`:

```ts
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SessionMetadata = {
  sessionId: string;
  provider?: string;
  model?: string;
  workspacePath: string;
  traceTaskId?: string;
  summary?: string;
  updatedAt: string;
};

export class SessionMetadataStore {
  private readonly sessionDir: string;

  constructor(private readonly workspacePath: string) {
    this.sessionDir = join(workspacePath, ".potato", "sessions");
  }

  async save(metadata: SessionMetadata): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    await writeFile(this.pathFor(metadata.sessionId), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  }

  async list(): Promise<SessionMetadata[]> {
    let names: string[];
    try {
      names = await readdir(this.sessionDir);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
    const sessions = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(join(this.sessionDir, name), "utf8")) as SessionMetadata)
    );
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private pathFor(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.json`);
  }
}
```

- [ ] **Step 3: Export metadata store**

Modify `core/src/index.ts`:

```ts
export { SessionMetadataStore } from "./session/SessionMetadataStore.js";
export type { SessionMetadata } from "./session/SessionMetadataStore.js";
```

- [ ] **Step 4: Persist metadata from session turns**

Add optional metadata store dependency to `AgentSession` constructor:

```ts
private readonly metadataStore?: Pick<SessionMetadataStore, "save">,
private readonly metadata?: Omit<SessionMetadata, "updatedAt" | "summary">
```

After `task.finished`, call:

```ts
  const sessionId = this.metadata?.sessionId ?? this.sessionId;
  await this.metadataStore?.save({
  ...this.metadata,
  sessionId,
  workspacePath: this.workspacePath,
  traceTaskId: event.taskId,
  summary: event.summary,
  updatedAt: nowIso()
});
```

Generate `this.sessionId = \`session_${Date.now()}\`` once in the `AgentSession` constructor, and reuse it for the life of that `AgentSession`.

- [ ] **Step 5: Add `/resume` list to TUI**

Add command option:

```ts
{ command: "/resume", label: "/resume", description: "列出可恢复会话" },
```

Add optional prop:

```ts
sessionMetadataStore?: Pick<SessionMetadataStore, "list">;
```

Handle:

```ts
if (prompt === "/resume") {
  const sessions = await props.sessionMetadataStore?.list();
  if (!sessions || sessions.length === 0) {
    appendEvent({ kind: "muted", text: "resume: 没有可恢复会话。" });
    return;
  }
  appendEvents(sessions.slice(0, 10).map((session) => ({
    kind: "muted",
    text: `resume: ${session.sessionId} ${session.provider ?? "unknown"}/${session.model ?? "unknown"} ${session.updatedAt}`
  })));
  return;
}
```

- [ ] **Step 6: Add TUI resume list test**

Add to `cli/tests/tui-render.test.ts`:

```ts
it("lists resumable sessions with /resume", async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), "coding-agent-tui-"));
  const rendered = render(
    React.createElement(AgentTui, {
      config: { workspacePath, provider: "deepseek", model: "deepseek-reasoner" },
      sessionMetadataStore: {
        list: async () => [{ sessionId: "session_1", provider: "deepseek", model: "deepseek-reasoner", workspacePath, updatedAt: "2026-07-07T00:00:00.000Z" }]
      }
    })
  );

  rendered.stdin.write("/resume");
  await new Promise((resolve) => setTimeout(resolve, 0));
  rendered.stdin.write("\r");

  await waitForFrame(rendered.lastFrame, "resume: session_1 deepseek/deepseek-reasoner");
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter @potato/core test -- session-metadata-store agent-session-factory
pnpm --filter @potato/cli test -- tui-render
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add core/src/session core/src/index.ts core/tests/session-metadata-store.test.ts core/tests/agent-session-factory.test.ts cli/src/ui cli/tests/tui-render.test.ts
git commit -m "feat: persist session metadata"
```

---

## Task 7: Context Compaction Correctness

**Files:**
- Modify: `core/src/context/ContextBudget.ts`
- Modify: `core/src/session/AgentSession.ts`
- Modify: `core/src/pi/PiSessionAdapter.ts`
- Test: `core/tests/agent-session-factory.test.ts`
- Test: `core/tests/agent-loop.test.ts`

- [ ] **Step 1: Write failing test for real compaction preference**

Add to `core/tests/agent-session-factory.test.ts`:

```ts
it("records native compaction as reduced budget state for later turns", async () => {
  const adapter = new FakeSessionAdapter();
  const traceStore = new MemoryTraceStore();
  const factory = new AgentSessionFactory({
    createAdapter: () => adapter,
    createTraceStore: () => traceStore,
    createContextBudget: () => new HeuristicContextBudgetManager(1000, 0.75),
    env: { DEEPSEEK_API_KEY: "test-key" }
  });
  const session = await factory.create({
    provider: "deepseek",
    model: "deepseek-reasoner",
    workspacePath: "/repo"
  });

  for await (const _event of session.compactContext("manual")) {
    // consume compaction
  }
  let nextBudget = 0;
  for await (const _event of session.send("continue")) {
    if (_event.type === "context.budget") nextBudget = _event.usedTokens;
  }

  const compactTrace = traceStore.entries.find((entry) => entry.kind === "context.compacted");
  expect(compactTrace).toEqual(expect.objectContaining({ kind: "context.compacted" }));
  expect(nextBudget).toBeLessThan(100);
});
```

This test locks in that native compaction is traced and that the local budget tracker records the reduced token state. Do not inject heuristic summaries into user prompts for Pi RPC sessions; Pi native compaction owns the actual model-side context mutation.

- [ ] **Step 2: Add explicit compaction state to context manager**

Modify `core/src/context/ContextBudget.ts`:

```ts
export type ContextBudgetManager = {
  maxTokens: number;
  compactAtRatio: number;
  estimate(input: RunTaskInput): ContextBudgetSnapshot;
  record?(input: RunTaskInput, output?: string): void;
  recordCompaction?(result: ContextCompactionResult): void;
  compact(input: RunTaskInput, budget: ContextBudgetSnapshot): Promise<ContextCompactionResult>;
};
```

Implement in `HeuristicContextBudgetManager`:

```ts
recordCompaction(result: ContextCompactionResult): void {
  this.accumulatedTokens = result.compactedTokens;
}
```

- [ ] **Step 3: Record compaction after native and fallback compaction**

In `AgentSession.compactContext()`, after native compaction succeeds:

```ts
this.contextBudget?.recordCompaction?.(compacted);
```

In fallback `prepareContext()`, after `contextBudget.compact()` succeeds:

```ts
this.contextBudget.recordCompaction?.(result);
```

Apply the same logic in `AgentLoop.prepareContext()`.

- [ ] **Step 4: Run context tests**

Run:

```bash
pnpm --filter @potato/core test -- agent-session-factory agent-loop
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/src/context core/src/session core/src/loop core/tests
git commit -m "fix: record context compaction state"
```

---

## Task 8: Documentation and Full Verification

**Files:**
- Modify: `wiki/project-state.md`
- Modify: `README.md` if user-facing command list is present
- Test: full workspace verification

- [ ] **Step 1: Update project state**

Add a section to `wiki/project-state.md`:

```md
## Next Core Batch Status

- Task cancellation is a first-class runtime control path. TUI `/cancel` and Ctrl+C stop the active task and emit `TASK_CANCELLED` into trace.
- Verification runner can execute configured or auto-detected verification commands after successful task execution.
- Runtime status is visible through `/status` and the TUI status line.
- Session metadata is persisted under `.potato/sessions/` and `/resume` lists recent sessions.
- Context compaction records reduced token state after native or fallback compaction.
```

- [ ] **Step 2: Update README command list**

If `README.md` lists TUI commands, add:

```md
- `/cancel`: cancel the active task.
- `/status`: show adapter, provider, model, permission mode, and workspace.
- `/resume`: list recent resumable sessions.
```

- [ ] **Step 3: Run package tests**

Run:

```bash
pnpm --filter @potato/protocol test
pnpm --filter @potato/core test
pnpm --filter @potato/cli test
```

Expected: all tests PASS.

- [ ] **Step 4: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit docs**

```bash
git add wiki/project-state.md README.md
git commit -m "docs: document control verification diagnostics"
```

---

## Self-Review

- Spec coverage: cancellation, verification, config/status diagnostics, session metadata, and context compaction correctness each have a dedicated task with tests.
- Trace coverage: cancellation and verification are emitted as existing trace `event` and `task.failed` entries; no new trace storage format is required.
- Scope control: in-TUI trace browser, system prompt editor, workspace switching, retry UX, and SubAgent nested visualization are intentionally excluded from this batch.
- Type consistency: cancellation uses existing `task.failed` with `error.code = "TASK_CANCELLED"`; verification uses existing `verification.started` and `verification.finished` protocol events.
- Risk: `VerificationRunner.splitCommand()` is intentionally simple. If quoted shell commands are needed later, add a parser or support `shell: true` explicitly in a separate task.
