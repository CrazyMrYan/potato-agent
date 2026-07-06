# M5 Core Trace Diff Runtime Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JSONL task tracing, Git-backed diff output, trace/diff CLI commands, tested tool permission policy, and a runtime capability reporting path for aggressive permission validation.

**Architecture:** Keep `PiRpcAdapter` as the default working execution path. Put trace, diff, and tool policy in `@potato/core`, with `AgentOrchestrator` applying trace/diff around adapter events. Add a switchable runtime capability reporter that states which permission guarantees are actually enforced.

**Tech Stack:** TypeScript, Node.js built-ins, pnpm workspace, Vitest, commander, Git CLI.

---

## File Structure

- Create `core/src/trace/TraceStore.ts`: trace entry types and store interface.
- Create `core/src/trace/JsonlTraceStore.ts`: file-backed JSONL trace writer/reader.
- Create `core/tests/trace-store.test.ts`: trace store tests.
- Create `core/src/diff/DiffService.ts`: Git-backed `ChangeSet` generation.
- Create `core/tests/diff-service.test.ts`: diff service tests using temporary Git repos.
- Modify `core/src/orchestrator/AgentOrchestrator.ts`: write trace entries and emit diff after completion.
- Modify `core/tests/orchestrator.test.ts`: verify trace/diff integration.
- Create `core/src/tools/ToolBoundary.ts`: permission decision model independent of Pi.
- Create `core/tests/tool-boundary.test.ts`: allow/confirm/deny/readonly tests.
- Create `core/src/runtime/RuntimeCapabilityReporter.ts`: factual capability report for RPC and future SDK/runtime paths.
- Create `core/tests/runtime-capability-reporter.test.ts`: capability report tests.
- Modify `core/src/index.ts`: export new APIs.
- Create `cli/src/commands/diff.ts`: `potato diff` command handler.
- Create `cli/src/commands/trace.ts`: `potato trace` command handler.
- Modify `cli/src/cli.ts`: register `diff` and `trace`.
- Create `cli/tests/diff-command.test.ts`: diff command tests.
- Create `cli/tests/trace-command.test.ts`: trace command tests.
- Modify `wiki/project-state.md`: mark M5 as in progress and document adapter permission guarantees.
- Modify `wiki/technical-design.md`: add trace/diff/tool boundary details.

## Task 1: JSONL Trace Store

**Files:**
- Create: `core/src/trace/TraceStore.ts`
- Create: `core/src/trace/JsonlTraceStore.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/trace-store.test.ts`

- [ ] **Step 1: Write the failing trace store tests**

Create `core/tests/trace-store.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlTraceStore } from "../src/trace/JsonlTraceStore.js";

describe("JsonlTraceStore", () => {
  it("appends and reads task trace entries", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-trace-"));
    try {
      const store = new JsonlTraceStore(workspace);

      await store.append({
        timestamp: "2026-07-04T00:00:00.000Z",
        taskId: "task_1",
        kind: "task.input",
        input: {
          taskId: "task_1",
          workspacePath: workspace,
          prompt: "explain",
          mode: "run",
          approvalMode: "manual"
        }
      });
      await store.append({
        timestamp: "2026-07-04T00:00:01.000Z",
        taskId: "task_1",
        kind: "task.finished",
        summary: "done"
      });

      await expect(store.read("task_1")).resolves.toEqual([
        expect.objectContaining({ kind: "task.input", taskId: "task_1" }),
        expect.objectContaining({ kind: "task.finished", taskId: "task_1", summary: "done" })
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("lists traces from newest to oldest", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "coding-agent-trace-list-"));
    try {
      const store = new JsonlTraceStore(workspace);
      await store.append({ timestamp: "2026-07-04T00:00:00.000Z", taskId: "task_old", kind: "task.finished", summary: "old" });
      await store.append({ timestamp: "2026-07-04T00:00:02.000Z", taskId: "task_new", kind: "task.finished", summary: "new" });

      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ taskId: "task_new" }),
        expect.objectContaining({ taskId: "task_old" })
      ]);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the trace store test and verify it fails**

Run:

```bash
pnpm --filter @potato/core test -- trace-store
```

Expected: FAIL because `../src/trace/JsonlTraceStore.js` does not exist.

- [ ] **Step 3: Implement trace types**

Create `core/src/trace/TraceStore.ts`:

```ts
import type { AgentEvent, ChangeSet, RunTaskInput } from "@potato/protocol";

export type TraceEntry =
  | { timestamp: string; taskId: string; kind: "task.input"; input: RunTaskInput }
  | { timestamp: string; taskId: string; kind: "event"; event: AgentEvent }
  | { timestamp: string; taskId: string; kind: "diff"; changeSet: ChangeSet }
  | { timestamp: string; taskId: string; kind: "task.finished"; summary: string }
  | { timestamp: string; taskId: string; kind: "task.failed"; code: string; message: string; cause?: string }
  | { timestamp: string; taskId: string; kind: "runtime.capability"; capability: RuntimeCapabilityReport };

export type RuntimeCapabilityReport = {
  adapter: "rpc" | "sdk" | "runtime";
  systemPrompt: boolean;
  skills: boolean;
  mcpServers: boolean;
  toolAllowDeny: boolean;
  toolInterception: boolean;
  toolBoundaryApproval: boolean;
  notes: string[];
};

export type TraceSummary = {
  taskId: string;
  path: string;
  updatedAt: string;
  entries: number;
};

export interface TraceStore {
  append(entry: TraceEntry): Promise<void>;
  read(taskId: string): Promise<TraceEntry[]>;
  list(): Promise<TraceSummary[]>;
}

export function nowIso(): string {
  return new Date().toISOString();
}
```

- [ ] **Step 4: Implement JSONL trace store**

Create `core/src/trace/JsonlTraceStore.ts`:

```ts
import { mkdir, readFile, readdir, stat, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TraceEntry, TraceStore, TraceSummary } from "./TraceStore.js";

export class JsonlTraceStore implements TraceStore {
  private readonly traceDir: string;

  constructor(private readonly workspacePath: string) {
    this.traceDir = join(workspacePath, ".potato", "traces");
  }

  async append(entry: TraceEntry): Promise<void> {
    const filePath = this.pathFor(entry.taskId);
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async read(taskId: string): Promise<TraceEntry[]> {
    const content = await readFile(this.pathFor(taskId), "utf8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as TraceEntry);
  }

  async list(): Promise<TraceSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.traceDir);
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const summaries = await Promise.all(
      names
        .filter((name) => name.endsWith(".jsonl"))
        .map(async (name): Promise<TraceSummary> => {
          const path = join(this.traceDir, name);
          const content = await readFile(path, "utf8");
          const entries = content.split("\n").filter((line) => line.trim().length > 0);
          const fileStat = await stat(path);
          return {
            taskId: name.slice(0, -".jsonl".length),
            path,
            updatedAt: fileStat.mtime.toISOString(),
            entries: entries.length
          };
        })
    );

    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private pathFor(taskId: string): string {
    return join(this.traceDir, `${taskId}.jsonl`);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
```

- [ ] **Step 5: Export trace APIs**

Modify `core/src/index.ts`:

```ts
export { JsonlTraceStore } from "./trace/JsonlTraceStore.js";
export type { RuntimeCapabilityReport, TraceEntry, TraceStore, TraceSummary } from "./trace/TraceStore.js";
export { nowIso } from "./trace/TraceStore.js";
```

- [ ] **Step 6: Run trace store tests**

Run:

```bash
pnpm --filter @potato/core test -- trace-store
```

Expected: PASS.

- [ ] **Step 7: Commit trace store**

Run:

```bash
git add core/src/trace core/tests/trace-store.test.ts core/src/index.ts
git commit -m "feat: add jsonl trace store"
```

## Task 2: Git Diff Service

**Files:**
- Create: `core/src/diff/DiffService.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/diff-service.test.ts`

- [ ] **Step 1: Write failing diff service tests**

Create `core/tests/diff-service.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GitDiffService } from "../src/diff/DiffService.js";

const execFileAsync = promisify(execFile);

describe("GitDiffService", () => {
  it("returns an empty changeset for a clean repository", async () => {
    const workspace = await initRepo();
    try {
      const service = new GitDiffService();
      await expect(service.getChangeSet(workspace)).resolves.toEqual({ files: [] });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("maps modified, added, and deleted files into a changeset", async () => {
    const workspace = await initRepo();
    try {
      await writeFile(join(workspace, "tracked.txt"), "changed\n", "utf8");
      await writeFile(join(workspace, "added.txt"), "new\n", "utf8");
      await rm(join(workspace, "deleted.txt"));

      const changeSet = await new GitDiffService().getChangeSet(workspace);

      expect(changeSet.files.map((file) => [file.path, file.status])).toEqual([
        ["added.txt", "added"],
        ["deleted.txt", "deleted"],
        ["tracked.txt", "modified"]
      ]);
      expect(changeSet.files.find((file) => file.path === "tracked.txt")?.diff).toContain("-initial");
      expect(changeSet.files.find((file) => file.path === "tracked.txt")?.diff).toContain("+changed");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

async function initRepo(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "coding-agent-diff-"));
  await execFileAsync("git", ["init"], { cwd: workspace });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspace });
  await writeFile(join(workspace, "tracked.txt"), "initial\n", "utf8");
  await writeFile(join(workspace, "deleted.txt"), "delete me\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: workspace });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspace });
  return workspace;
}
```

- [ ] **Step 2: Run the diff service test and verify it fails**

Run:

```bash
pnpm --filter @potato/core test -- diff-service
```

Expected: FAIL because `../src/diff/DiffService.js` does not exist.

- [ ] **Step 3: Implement Git diff service**

Create `core/src/diff/DiffService.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangeSet, FileChangeStatus } from "@potato/protocol";

const execFileAsync = promisify(execFile);

export interface DiffService {
  getChangeSet(workspacePath: string): Promise<ChangeSet>;
}

export class GitDiffService implements DiffService {
  async getChangeSet(workspacePath: string): Promise<ChangeSet> {
    const status = await git(["status", "--porcelain=v1"], workspacePath);
    const files = await Promise.all(
      status
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map(async (line) => {
          const parsed = parseStatusLine(line);
          return {
            path: parsed.path,
            status: parsed.status,
            diff: await getFileDiff(workspacePath, parsed.path)
          };
        })
    );

    return { files: files.sort((left, right) => left.path.localeCompare(right.path)) };
  }
}

async function getFileDiff(workspacePath: string, path: string): Promise<string | undefined> {
  const trackedDiff = await git(["diff", "--", path], workspacePath);
  if (trackedDiff.trim()) {
    return trackedDiff;
  }

  const stagedDiff = await git(["diff", "--cached", "--", path], workspacePath);
  if (stagedDiff.trim()) {
    return stagedDiff;
  }

  return undefined;
}

function parseStatusLine(line: string): { path: string; status: FileChangeStatus } {
  const code = line.slice(0, 2);
  const rawPath = line.slice(3);
  const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) as string : rawPath;

  if (code.includes("A") || code === "??") {
    return { path, status: "added" };
  }
  if (code.includes("D")) {
    return { path, status: "deleted" };
  }
  if (code.includes("R")) {
    return { path, status: "renamed" };
  }
  return { path, status: "modified" };
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}
```

- [ ] **Step 4: Export diff APIs**

Modify `core/src/index.ts`:

```ts
export { GitDiffService } from "./diff/DiffService.js";
export type { DiffService } from "./diff/DiffService.js";
```

- [ ] **Step 5: Run diff service tests**

Run:

```bash
pnpm --filter @potato/core test -- diff-service
```

Expected: PASS.

- [ ] **Step 6: Commit diff service**

Run:

```bash
git add core/src/diff core/tests/diff-service.test.ts core/src/index.ts
git commit -m "feat: add git diff service"
```

## Task 3: Orchestrator Trace and Diff Integration

**Files:**
- Modify: `core/src/orchestrator/AgentOrchestrator.ts`
- Test: `core/tests/orchestrator.test.ts`

- [ ] **Step 1: Write failing orchestrator integration tests**

Replace `core/tests/orchestrator.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent, ChangeSet, RunTaskInput } from "@potato/protocol";
import { AgentOrchestrator } from "../src/orchestrator/AgentOrchestrator.js";
import type { DiffService } from "../src/diff/DiffService.js";
import type { TraceEntry, TraceStore } from "../src/trace/TraceStore.js";
import { FakePiAdapter } from "../src/pi/FakePiAdapter.js";

describe("AgentOrchestrator", () => {
  it("emits task started and fake adapter events", async () => {
    const orchestrator = new AgentOrchestrator(new FakePiAdapter());
    const events = [];

    for await (const event of orchestrator.run(input())) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "step.started",
      "tool.started",
      "tool.finished",
      "diff.produced",
      "task.finished"
    ]);
  });

  it("writes task input, events, diff, and final state to trace", async () => {
    const traceStore = new MemoryTraceStore();
    const diffService = new StaticDiffService({ files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] });
    const orchestrator = new AgentOrchestrator(new FakePiAdapter(), { traceStore, diffService });

    for await (const _event of orchestrator.run(input())) {
      // consume stream
    }

    expect(traceStore.entries.map((entry) => entry.kind)).toContain("task.input");
    expect(traceStore.entries.filter((entry) => entry.kind === "event").length).toBeGreaterThan(0);
    expect(traceStore.entries).toContainEqual(expect.objectContaining({ kind: "diff" }));
    expect(traceStore.entries).toContainEqual(expect.objectContaining({ kind: "task.finished" }));
  });

  it("emits diff.produced after adapter completion when diff has files", async () => {
    const diffService = new StaticDiffService({ files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] });
    const orchestrator = new AgentOrchestrator(new FakePiAdapter(), { diffService });
    const events: AgentEvent[] = [];

    for await (const event of orchestrator.run(input())) {
      events.push(event);
    }

    expect(events.at(-2)).toEqual({
      type: "diff.produced",
      taskId: "task_1",
      changeSet: { files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] }
    });
    expect(events.at(-1)?.type).toBe("task.finished");
  });
});

function input(): RunTaskInput {
  return {
    taskId: "task_1",
    workspacePath: "/repo",
    prompt: "测试任务",
    mode: "run",
    approvalMode: "manual"
  };
}

class MemoryTraceStore implements TraceStore {
  entries: TraceEntry[] = [];
  async append(entry: TraceEntry): Promise<void> {
    this.entries.push(entry);
  }
  async read(): Promise<TraceEntry[]> {
    return this.entries;
  }
  async list(): Promise<never[]> {
    return [];
  }
}

class StaticDiffService implements DiffService {
  constructor(private readonly changeSet: ChangeSet) {}
  async getChangeSet(): Promise<ChangeSet> {
    return this.changeSet;
  }
}
```

- [ ] **Step 2: Run orchestrator tests and verify they fail**

Run:

```bash
pnpm --filter @potato/core test -- orchestrator
```

Expected: FAIL because `AgentOrchestrator` does not accept `traceStore` or `diffService`.

- [ ] **Step 3: Implement orchestrator dependencies**

Modify `core/src/orchestrator/AgentOrchestrator.ts`:

```ts
import type { AgentEvent, RunTaskInput } from "@potato/protocol";
import type { DiffService } from "../diff/DiffService.js";
import type { PiAdapter } from "../pi/PiAdapter.js";
import type { TraceStore } from "../trace/TraceStore.js";
import { nowIso } from "../trace/TraceStore.js";

export type AgentOrchestratorDependencies = {
  traceStore?: TraceStore;
  diffService?: DiffService;
};

export class AgentOrchestrator {
  constructor(
    private readonly piAdapter: PiAdapter,
    private readonly dependencies: AgentOrchestratorDependencies = {}
  ) {}

  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    await this.trace({
      timestamp: nowIso(),
      taskId: input.taskId,
      kind: "task.input",
      input
    });

    const started: AgentEvent = {
      type: "task.started",
      taskId: input.taskId,
      workspacePath: input.workspacePath,
      prompt: input.prompt
    };
    await this.traceEvent(started);
    yield started;

    let finalEvent: AgentEvent | undefined;
    for await (const event of this.piAdapter.run(input)) {
      if (event.type === "task.finished" || event.type === "task.failed") {
        finalEvent = event;
        continue;
      }

      await this.traceEvent(event);
      yield event;
    }

    if (finalEvent?.type !== "task.failed") {
      const changeSet = await this.dependencies.diffService?.getChangeSet(input.workspacePath);
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

  async cancel(_taskId: string): Promise<void> {
    return;
  }

  private async traceEvent(event: AgentEvent): Promise<void> {
    await this.trace({ timestamp: nowIso(), taskId: event.taskId, kind: "event", event });
  }

  private async trace(entry: Parameters<TraceStore["append"]>[0]): Promise<void> {
    await this.dependencies.traceStore?.append(entry);
  }
}
```

- [ ] **Step 4: Run orchestrator tests**

Run:

```bash
pnpm --filter @potato/core test -- orchestrator
```

Expected: PASS.

- [ ] **Step 5: Commit orchestrator integration**

Run:

```bash
git add core/src/orchestrator/AgentOrchestrator.ts core/tests/orchestrator.test.ts
git commit -m "feat: trace and diff orchestrator runs"
```

## Task 4: CLI Diff and Trace Commands

**Files:**
- Create: `cli/src/commands/diff.ts`
- Create: `cli/src/commands/trace.ts`
- Modify: `cli/src/cli.ts`
- Test: `cli/tests/diff-command.test.ts`
- Test: `cli/tests/trace-command.test.ts`

- [ ] **Step 1: Write failing diff command test**

Create `cli/tests/diff-command.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { diffCommand } from "../src/commands/diff.js";

describe("diff command", () => {
  it("prints changed files", async () => {
    const write = vi.fn();

    await diffCommand({
      workspacePath: "/repo",
      write,
      diffService: {
        async getChangeSet() {
          return { files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] };
        }
      }
    });

    expect(write).toHaveBeenCalledWith("modified src/a.ts");
    expect(write).toHaveBeenCalledWith("patch");
  });
});
```

- [ ] **Step 2: Write failing trace command test**

Create `cli/tests/trace-command.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { traceCommand } from "../src/commands/trace.js";

describe("trace command", () => {
  it("lists traces when no task id is provided", async () => {
    const write = vi.fn();
    await traceCommand({
      workspacePath: "/repo",
      write,
      traceStore: {
        async list() {
          return [{ taskId: "task_1", path: "/repo/.potato/traces/task_1.jsonl", updatedAt: "2026-07-04T00:00:00.000Z", entries: 3 }];
        },
        async read() {
          return [];
        },
        async append() {}
      }
    });

    expect(write).toHaveBeenCalledWith("task_1 3 entries 2026-07-04T00:00:00.000Z");
  });

  it("prints raw trace entries for a task id", async () => {
    const write = vi.fn();
    await traceCommand({
      workspacePath: "/repo",
      taskId: "task_1",
      raw: true,
      write,
      traceStore: {
        async list() {
          return [];
        },
        async read() {
          return [{ timestamp: "2026-07-04T00:00:00.000Z", taskId: "task_1", kind: "task.finished", summary: "done" }];
        },
        async append() {}
      }
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining("\"kind\":\"task.finished\""));
  });
});
```

- [ ] **Step 3: Run CLI command tests and verify they fail**

Run:

```bash
pnpm --filter @potato/cli test -- diff-command trace-command
```

Expected: FAIL because command modules do not exist.

- [ ] **Step 4: Implement diff command**

Create `cli/src/commands/diff.ts`:

```ts
import { GitDiffService, type DiffService } from "@potato/core";

export type DiffCommandOptions = {
  workspacePath?: string;
  patch?: boolean;
  write?: (line: string) => void;
  diffService?: DiffService;
};

export async function diffCommand(options: DiffCommandOptions = {}): Promise<void> {
  const workspacePath = options.workspacePath ?? process.cwd();
  const write = options.write ?? console.log;
  const diffService = options.diffService ?? new GitDiffService();
  const changeSet = await diffService.getChangeSet(workspacePath);

  if (changeSet.files.length === 0) {
    write("No changes.");
    return;
  }

  for (const file of changeSet.files) {
    write(`${file.status} ${file.path}`);
    if ((options.patch ?? true) && file.diff) {
      write(file.diff);
    }
  }
}
```

- [ ] **Step 5: Implement trace command**

Create `cli/src/commands/trace.ts`:

```ts
import { JsonlTraceStore, type TraceStore } from "@potato/core";

export type TraceCommandOptions = {
  workspacePath?: string;
  taskId?: string;
  raw?: boolean;
  write?: (line: string) => void;
  traceStore?: TraceStore;
};

export async function traceCommand(options: TraceCommandOptions = {}): Promise<void> {
  const workspacePath = options.workspacePath ?? process.cwd();
  const write = options.write ?? console.log;
  const traceStore = options.traceStore ?? new JsonlTraceStore(workspacePath);

  if (!options.taskId) {
    const traces = await traceStore.list();
    if (traces.length === 0) {
      write("No traces.");
      return;
    }
    for (const trace of traces) {
      write(`${trace.taskId} ${trace.entries} entries ${trace.updatedAt}`);
    }
    return;
  }

  const entries = await traceStore.read(options.taskId);
  for (const entry of entries) {
    write(options.raw ? JSON.stringify(entry) : `${entry.timestamp} ${entry.kind}`);
  }
}
```

- [ ] **Step 6: Register CLI commands**

Modify `cli/src/cli.ts`:

```ts
import { diffCommand } from "./commands/diff.js";
import { traceCommand } from "./commands/trace.js";
```

Add command registrations before `await program.parseAsync(process.argv);`:

```ts
program
  .command("diff")
  .description("显示当前工作区的 Git diff")
  .option("--workspace <path>", "要查看的项目目录", process.cwd())
  .option("--no-patch", "只显示文件列表，不显示 patch")
  .action(async (options: { workspace: string; patch: boolean }) => {
    try {
      await diffCommand({ workspacePath: options.workspace, patch: options.patch });
    } catch (error) {
      console.error(formatCliError(error));
      process.exitCode = 1;
    }
  });

program
  .command("trace")
  .description("查看任务 trace")
  .argument("[taskId]", "任务 ID")
  .option("--workspace <path>", "要查看的项目目录", process.cwd())
  .option("--raw", "输出原始 JSONL 条目")
  .action(async (taskId: string | undefined, options: { workspace: string; raw?: boolean }) => {
    try {
      await traceCommand({ workspacePath: options.workspace, taskId, raw: options.raw });
    } catch (error) {
      console.error(formatCliError(error));
      process.exitCode = 1;
    }
  });
```

- [ ] **Step 7: Run CLI command tests**

Run:

```bash
pnpm --filter @potato/cli test -- diff-command trace-command
```

Expected: PASS.

- [ ] **Step 8: Commit CLI commands**

Run:

```bash
git add cli/src/commands/diff.ts cli/src/commands/trace.ts cli/src/cli.ts cli/tests/diff-command.test.ts cli/tests/trace-command.test.ts
git commit -m "feat: add trace and diff commands"
```

## Task 5: Wire Trace and Diff Into Run Command

**Files:**
- Modify: `cli/src/commands/run.ts`
- Test: `cli/tests/run-config.test.ts`

- [ ] **Step 1: Add failing run command integration test**

Append this test to `cli/tests/run-config.test.ts`:

```ts
  it("wires trace store and diff service into orchestrator", async () => {
    const writes: string[] = [];
    const adapter: PiAdapter = {
      async *run(input) {
        yield { type: "task.finished", taskId: input.taskId, summary: "done" };
      }
    };

    await runCommand("解释项目", {
      workspacePath: "/tmp/example",
      createAdapter: () => adapter,
      createTraceStore: () => ({
        async append() {},
        async read() {
          return [];
        },
        async list() {
          return [];
        }
      }),
      createDiffService: () => ({
        async getChangeSet() {
          return { files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] };
        }
      }),
      write: (line) => writes.push(line)
    });

    expect(writes.join("\n")).toContain("diff 1 个文件");
  });
```

- [ ] **Step 2: Run the run command test and verify it fails**

Run:

```bash
pnpm --filter @potato/cli test -- run-config
```

Expected: FAIL because `createTraceStore` and `createDiffService` are not part of `RunCommandOptions`.

- [ ] **Step 3: Implement run command wiring**

Modify `cli/src/commands/run.ts`:

```ts
import {
  AgentOrchestrator,
  GitDiffService,
  JsonlTraceStore,
  LocalAgentGateway,
  type DiffService,
  type PiAdapter,
  PiRpcAdapter,
  resolvePiAdapterOptions,
  type TraceStore
} from "@potato/core";
```

Extend `RunCommandOptions`:

```ts
  createTraceStore?: (workspacePath: string) => TraceStore;
  createDiffService?: () => DiffService;
```

Replace orchestrator construction:

```ts
  const traceStore = options.createTraceStore ? options.createTraceStore(workspacePath) : new JsonlTraceStore(workspacePath);
  const diffService = options.createDiffService ? options.createDiffService() : new GitDiffService();
  const gateway = new LocalAgentGateway(new AgentOrchestrator(adapter, { traceStore, diffService }));
```

- [ ] **Step 4: Run run command tests**

Run:

```bash
pnpm --filter @potato/cli test -- run-config
```

Expected: PASS.

- [ ] **Step 5: Commit run wiring**

Run:

```bash
git add cli/src/commands/run.ts cli/tests/run-config.test.ts
git commit -m "feat: record run traces and diffs"
```

## Task 6: Tool Boundary Policy

**Files:**
- Create: `core/src/tools/ToolBoundary.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/tool-boundary.test.ts`

- [ ] **Step 1: Write failing tool boundary tests**

Create `core/tests/tool-boundary.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_PERMISSION_POLICY } from "../src/config/AgentConfig.js";
import { ToolBoundary } from "../src/tools/ToolBoundary.js";

describe("ToolBoundary", () => {
  it("allows read tools from the default policy", async () => {
    const boundary = new ToolBoundary(DEFAULT_AGENT_PERMISSION_POLICY);
    await expect(boundary.decide({ tool: "read", summary: "read README.md" })).resolves.toEqual({ decision: "allow" });
  });

  it("requires confirmation for bash from the default policy", async () => {
    const boundary = new ToolBoundary(DEFAULT_AGENT_PERMISSION_POLICY);
    await expect(boundary.decide({ tool: "bash", summary: "pnpm test" })).resolves.toEqual({ decision: "confirm" });
  });

  it("denies tools in readonly mode unless they are allowed read tools", async () => {
    const boundary = new ToolBoundary({ mode: "readonly", allow: ["read"], confirm: [], deny: [] });
    await expect(boundary.decide({ tool: "bash", summary: "rm -rf dist" })).resolves.toEqual({
      decision: "deny",
      reason: "readonly mode blocks bash"
    });
  });

  it("uses approval callback for confirm decisions", async () => {
    const approve = vi.fn().mockResolvedValue(true);
    const boundary = new ToolBoundary(DEFAULT_AGENT_PERMISSION_POLICY, { approve });
    await expect(boundary.authorize({ tool: "bash", summary: "pnpm test" })).resolves.toEqual({ authorized: true });
    expect(approve).toHaveBeenCalledWith({ tool: "bash", summary: "pnpm test" });
  });
});
```

- [ ] **Step 2: Run tool boundary tests and verify they fail**

Run:

```bash
pnpm --filter @potato/core test -- tool-boundary
```

Expected: FAIL because `ToolBoundary` does not exist.

- [ ] **Step 3: Implement ToolBoundary**

Create `core/src/tools/ToolBoundary.ts`:

```ts
import type { AgentPermissionPolicy } from "../config/AgentConfig.js";
import { resolveAgentPermissionPolicy } from "../config/AgentConfig.js";

export type ToolRequest = {
  tool: string;
  summary: string;
};

export type ToolDecision =
  | { decision: "allow" }
  | { decision: "confirm" }
  | { decision: "deny"; reason: string };

export type ToolAuthorization = { authorized: true } | { authorized: false; reason: string };

export type ToolBoundaryDependencies = {
  approve?: (request: ToolRequest) => Promise<boolean>;
};

export class ToolBoundary {
  private readonly policy: Required<AgentPermissionPolicy>;

  constructor(
    policy: AgentPermissionPolicy,
    private readonly dependencies: ToolBoundaryDependencies = {}
  ) {
    this.policy = resolveAgentPermissionPolicy(policy);
  }

  async decide(request: ToolRequest): Promise<ToolDecision> {
    if (this.policy.deny.includes(request.tool)) {
      return { decision: "deny", reason: `policy denies ${request.tool}` };
    }

    if (this.policy.mode === "readonly" && !this.policy.allow.includes(request.tool)) {
      return { decision: "deny", reason: `readonly mode blocks ${request.tool}` };
    }

    if (this.policy.mode === "bypass") {
      return { decision: "allow" };
    }

    if (this.policy.allow.includes(request.tool)) {
      return { decision: "allow" };
    }

    if (this.policy.confirm.includes(request.tool)) {
      return { decision: "confirm" };
    }

    return { decision: "confirm" };
  }

  async authorize(request: ToolRequest): Promise<ToolAuthorization> {
    const decision = await this.decide(request);
    if (decision.decision === "allow") {
      return { authorized: true };
    }
    if (decision.decision === "deny") {
      return { authorized: false, reason: decision.reason };
    }

    const approved = await this.dependencies.approve?.(request);
    return approved ? { authorized: true } : { authorized: false, reason: `approval rejected ${request.tool}` };
  }
}
```

- [ ] **Step 4: Export ToolBoundary**

Modify `core/src/index.ts`:

```ts
export { ToolBoundary } from "./tools/ToolBoundary.js";
export type { ToolAuthorization, ToolBoundaryDependencies, ToolDecision, ToolRequest } from "./tools/ToolBoundary.js";
```

- [ ] **Step 5: Run tool boundary tests**

Run:

```bash
pnpm --filter @potato/core test -- tool-boundary
```

Expected: PASS.

- [ ] **Step 6: Commit tool boundary**

Run:

```bash
git add core/src/tools core/tests/tool-boundary.test.ts core/src/index.ts
git commit -m "feat: add tool permission boundary"
```

## Task 7: Runtime Capability Reporting

**Files:**
- Create: `core/src/runtime/RuntimeCapabilityReporter.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/runtime-capability-reporter.test.ts`
- Modify: `wiki/project-state.md`
- Modify: `wiki/technical-design.md`

- [ ] **Step 1: Write failing capability reporter tests**

Create `core/tests/runtime-capability-reporter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RuntimeCapabilityReporter } from "../src/runtime/RuntimeCapabilityReporter.js";

describe("RuntimeCapabilityReporter", () => {
  it("reports RPC capabilities without claiming tool interception", () => {
    expect(new RuntimeCapabilityReporter().forAdapter("rpc")).toEqual({
      adapter: "rpc",
      systemPrompt: true,
      skills: true,
      mcpServers: false,
      toolAllowDeny: true,
      toolInterception: false,
      toolBoundaryApproval: false,
      notes: expect.arrayContaining([expect.stringContaining("Pi RPC")])
    });
  });

  it("reports runtime path as experimental until backed by an implementation", () => {
    expect(new RuntimeCapabilityReporter().forAdapter("runtime")).toEqual({
      adapter: "runtime",
      systemPrompt: false,
      skills: false,
      mcpServers: false,
      toolAllowDeny: false,
      toolInterception: false,
      toolBoundaryApproval: false,
      notes: expect.arrayContaining([expect.stringContaining("experimental")])
    });
  });
});
```

- [ ] **Step 2: Run reporter tests and verify they fail**

Run:

```bash
pnpm --filter @potato/core test -- runtime-capability-reporter
```

Expected: FAIL because `RuntimeCapabilityReporter` does not exist.

- [ ] **Step 3: Implement reporter**

Create `core/src/runtime/RuntimeCapabilityReporter.ts`:

```ts
import type { RuntimeCapabilityReport } from "../trace/TraceStore.js";

export class RuntimeCapabilityReporter {
  forAdapter(adapter: RuntimeCapabilityReport["adapter"]): RuntimeCapabilityReport {
    if (adapter === "rpc") {
      return {
        adapter: "rpc",
        systemPrompt: true,
        skills: true,
        mcpServers: false,
        toolAllowDeny: true,
        toolInterception: false,
        toolBoundaryApproval: false,
        notes: [
          "Pi RPC accepts system prompt, appended system prompt, skills, and tool allow/deny through CLI args.",
          "Pi RPC still owns final tool execution, so core ToolBoundary approval is not enforced on this path."
        ]
      };
    }

    return {
      adapter,
      systemPrompt: false,
      skills: false,
      mcpServers: false,
      toolAllowDeny: false,
      toolInterception: false,
      toolBoundaryApproval: false,
      notes: [`${adapter} adapter is experimental until SDK/runtime tool interception is implemented.`]
    };
  }
}
```

- [ ] **Step 4: Export reporter**

Modify `core/src/index.ts`:

```ts
export { RuntimeCapabilityReporter } from "./runtime/RuntimeCapabilityReporter.js";
```

- [ ] **Step 5: Update wiki stage docs**

In `wiki/project-state.md`, set the next step to:

```md
下一步是执行 M5：trace/diff 落地，并以 runtime capability report 的方式验证 SDK/runtime 权限接管。当前 RPC 路径只能透传 system prompt、skills 和工具 allow/deny，不能声明 core 已接管最终工具权限。
```

In `wiki/technical-design.md`, add under Tool Boundary:

```md
M5 先把 `ToolBoundary` 作为 core 中可测试的权限决策点落地。`PiRpcAdapter` 默认路径仍由 Pi RPC 执行真实工具调用，因此 trace 必须记录 RPC 路径不具备 core 级工具拦截。后续只有 SDK/runtime adapter 能在工具执行前调用 `ToolBoundary` 时，才能声明权限由本项目接管。
```

- [ ] **Step 6: Run reporter tests**

Run:

```bash
pnpm --filter @potato/core test -- runtime-capability-reporter
```

Expected: PASS.

- [ ] **Step 7: Commit runtime reporting**

Run:

```bash
git add core/src/runtime core/tests/runtime-capability-reporter.test.ts core/src/index.ts wiki/project-state.md wiki/technical-design.md
git commit -m "feat: report runtime permission capabilities"
```

## Task 8: Full Verification

**Files:**
- Verify all touched packages.

- [ ] **Step 1: Run protocol tests**

Run:

```bash
pnpm --filter @potato/protocol test
```

Expected: PASS.

- [ ] **Step 2: Run core tests and typecheck**

Run:

```bash
pnpm --filter @potato/core test
pnpm --filter @potato/core typecheck
```

Expected: PASS.

- [ ] **Step 3: Run CLI tests and typecheck**

Run:

```bash
pnpm --filter @potato/cli test
pnpm --filter @potato/cli typecheck
```

Expected: PASS.

- [ ] **Step 4: Run root build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit any final fixes**

If verification requires fixes, inspect the changed files:

```bash
git status --short
```

Then stage the files that were changed by the verification fix. For example, if the fix touched `core/src/orchestrator/AgentOrchestrator.ts` and `core/tests/orchestrator.test.ts`, run:

```bash
git add core/src/orchestrator/AgentOrchestrator.ts core/tests/orchestrator.test.ts
git commit -m "fix: stabilize m5 trace diff permissions"
```

If there are no fixes, do not create an empty commit.

## Self-Review Notes

- Spec coverage: trace store is Task 1, diff service is Task 2, orchestrator trace/diff is Task 3, CLI commands are Task 4, run wiring is Task 5, ToolBoundary is Task 6, runtime permission reporting and wiki updates are Task 7, verification is Task 8.
- Permission boundary honesty: the plan does not claim RPC has core-level tool interception. It adds tested policy and factual reporting first.
- Scope: the plan does not replace the default adapter or build desktop UI.
