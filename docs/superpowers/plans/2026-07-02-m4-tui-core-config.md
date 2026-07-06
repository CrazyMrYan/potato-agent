# M4 TUI Core Config Implementation Plan

> 修订说明：M4 初版计划曾以 Ink/React 为 TUI 技术栈，后续实现已按项目要求切换到 `@vue-tui/runtime` + Vue。本文保留历史步骤用于追溯，当前事实以 `wiki/project-state.md`、`wiki/technical-plan-mvp.md` 和源码为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `potato` open a lightweight interactive TUI by default, allow runtime model configuration, and move session/config creation out of CLI into `@potato/core`.

**Architecture:** `core/` owns model config normalization, API key resolution, persisted workspace config, and session creation. `cli/` owns commander wiring and Vue TUI rendering only. The existing `run` and `chat` commands remain as compatibility paths.

**Tech Stack:** TypeScript, Node.js, pnpm workspace, Vitest, commander, @vue-tui/runtime, Vue, @inquirer/prompts, @earendil-works/pi-coding-agent.

---

## File Structure

Create and modify these files:

- Create `core/src/config/AgentConfig.ts`: shared config types and merge helpers.
- Create `core/src/config/AgentConfigStore.ts`: file-backed `.potato/config.json` config store.
- Create `core/src/session/AgentSession.ts`: session facade that wraps `PiSessionAdapter`.
- Create `core/src/session/AgentSessionFactory.ts`: creates sessions from runtime config.
- Modify `core/src/index.ts`: export config and session APIs.
- Create `core/tests/agent-config-store.test.ts`: config store tests.
- Create `core/tests/agent-session-factory.test.ts`: session factory tests.
- Modify `cli/package.json`: add `ink`, `react`, and `@types/react`.
- Create `cli/src/commands/tui.tsx`: render the default TUI.
- Create `cli/src/ui/AgentTui.ts`: Vue TUI component.
- Modify `cli/src/commands/chat.ts`: create sessions via core session factory.
- Modify `cli/src/commands/run.ts`: keep run compatibility, use core config shape where useful.
- Modify `cli/src/cli.ts`: default action opens TUI; keep `run` and `chat`.
- Create `cli/tests/tui-command.test.ts`: CLI TUI command behavior tests.
- Modify `wiki/project-state.md`: mark M4 progress.
- Modify `wiki/technical-plan-mvp.md`: keep M4 plan aligned.

## Task 1: Core Agent Config

**Files:**
- Create: `core/src/config/AgentConfig.ts`
- Create: `core/src/config/AgentConfigStore.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/agent-config-store.test.ts`

- [ ] **Step 1: Write failing config store tests**

Create `core/tests/agent-config-store.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileAgentConfigStore, mergeAgentConfig } from "../src/config/AgentConfigStore.js";

describe("FileAgentConfigStore", () => {
  it("returns an empty config when no config file exists", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-config-empty-"));
    try {
      const store = new FileAgentConfigStore(workspace);
      await expect(store.load()).resolves.toEqual({});
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("saves and loads workspace model config", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agent-config-save-"));
    try {
      const store = new FileAgentConfigStore(workspace);
      await store.save({ provider: "deepseek", model: "deepseek-reasoner", apiKey: "secret" });

      await expect(store.load()).resolves.toEqual({
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKey: "secret"
      });

      const raw = await readFile(join(workspace, ".potato", "config.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKey: "secret"
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe("mergeAgentConfig", () => {
  it("prefers runtime values over stored values and keeps workspace path", () => {
    expect(
      mergeAgentConfig(
        { provider: "deepseek", model: "deepseek-chat", apiKey: "stored", workspacePath: "/repo" },
        { model: "deepseek-reasoner", apiKey: "runtime" }
      )
    ).toEqual({
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKey: "runtime",
      workspacePath: "/repo"
    });
  });
});
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
pnpm --filter @potato/core test -- agent-config-store
```

Expected: fails because `AgentConfigStore` does not exist.

- [ ] **Step 3: Implement config types and file store**

Create `core/src/config/AgentConfig.ts`:

```ts
export type AgentConfig = {
  provider?: string;
  model?: string;
  apiKey?: string;
  workspacePath?: string;
  timeoutMs?: number;
};

export type ResolvedAgentConfig = Required<Pick<AgentConfig, "provider" | "model" | "apiKey" | "workspacePath">> &
  Pick<AgentConfig, "timeoutMs">;

export function mergeAgentConfig(stored: AgentConfig, runtime: AgentConfig): AgentConfig {
  return {
    ...stored,
    ...withoutUndefined(runtime)
  };
}

function withoutUndefined(config: AgentConfig): AgentConfig {
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) as AgentConfig;
}
```

Create `core/src/config/AgentConfigStore.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentConfig } from "./AgentConfig.js";
export { mergeAgentConfig } from "./AgentConfig.js";

export interface AgentConfigStore {
  load(): Promise<AgentConfig>;
  save(config: AgentConfig): Promise<void>;
}

export class FileAgentConfigStore implements AgentConfigStore {
  private readonly configPath: string;

  constructor(private readonly workspacePath: string) {
    this.configPath = join(workspacePath, ".potato", "config.json");
  }

  async load(): Promise<AgentConfig> {
    try {
      return JSON.parse(await readFile(this.configPath, "utf8")) as AgentConfig;
    } catch (error) {
      if (isNotFound(error)) {
        return {};
      }

      throw error;
    }
  }

  async save(config: AgentConfig): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    await writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
```

Modify `core/src/index.ts` to export:

```ts
export type { AgentConfig, ResolvedAgentConfig } from "./config/AgentConfig.js";
export { mergeAgentConfig } from "./config/AgentConfig.js";
export { FileAgentConfigStore, type AgentConfigStore } from "./config/AgentConfigStore.js";
```

- [ ] **Step 4: Run config tests and verify they pass**

Run:

```bash
pnpm --filter @potato/core test -- agent-config-store
```

Expected: tests pass.

## Task 2: Core Agent Session Factory

**Files:**
- Create: `core/src/session/AgentSession.ts`
- Create: `core/src/session/AgentSessionFactory.ts`
- Modify: `core/src/index.ts`
- Test: `core/tests/agent-session-factory.test.ts`

- [ ] **Step 1: Write failing session factory tests**

Create `core/tests/agent-session-factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@potato/protocol";
import type { PiSessionAdapter } from "../src/pi/PiSessionAdapter.js";
import { AgentSessionFactory } from "../src/session/AgentSessionFactory.js";

class FakeSessionAdapter implements PiSessionAdapter {
  started = false;
  stopped = false;
  prompts: string[] = [];

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async *send(prompt: string): AsyncIterable<AgentEvent> {
    this.prompts.push(prompt);
    yield { type: "task.finished", taskId: "turn_1", summary: `完成：${prompt}` };
  }
}

describe("AgentSessionFactory", () => {
  it("creates a reusable session through core", async () => {
    const adapter = new FakeSessionAdapter();
    const factory = new AgentSessionFactory({
      createAdapter: () => adapter,
      env: { DEEPSEEK_API_KEY: "test-key" }
    });

    const session = factory.create({
      provider: "deepseek",
      model: "deepseek-reasoner",
      workspacePath: "/repo"
    });

    await session.start();
    const events = [];
    for await (const event of session.send("解释项目")) {
      events.push(event);
    }
    await session.stop();

    expect(adapter.started).toBe(true);
    expect(adapter.prompts).toEqual(["解释项目"]);
    expect(adapter.stopped).toBe(true);
    expect(events).toEqual([{ type: "task.finished", taskId: "turn_1", summary: "完成：解释项目" }]);
  });
});
```

- [ ] **Step 2: Run session factory tests and verify they fail**

Run:

```bash
pnpm --filter @potato/core test -- agent-session-factory
```

Expected: fails because `AgentSessionFactory` does not exist.

- [ ] **Step 3: Implement session facade and factory**

Create `core/src/session/AgentSession.ts`:

```ts
import type { AgentEvent } from "@potato/protocol";
import type { PiSessionAdapter } from "../pi/PiSessionAdapter.js";

export class AgentSession {
  constructor(private readonly adapter: PiSessionAdapter) {}

  start(): Promise<void> {
    return this.adapter.start();
  }

  stop(): Promise<void> {
    return this.adapter.stop();
  }

  send(prompt: string): AsyncIterable<AgentEvent> {
    return this.adapter.send(prompt);
  }
}
```

Create `core/src/session/AgentSessionFactory.ts`:

```ts
import type { AgentConfig } from "../config/AgentConfig.js";
import { type PiSessionAdapter, PiRpcSessionAdapter } from "../pi/PiSessionAdapter.js";
import { resolvePiAdapterOptions } from "../pi/resolvePiAdapterOptions.js";
import { AgentSession } from "./AgentSession.js";

type AgentSessionFactoryDependencies = {
  createAdapter?: (config: AgentConfig) => PiSessionAdapter;
  env?: NodeJS.ProcessEnv;
};

export class AgentSessionFactory {
  constructor(private readonly dependencies: AgentSessionFactoryDependencies = {}) {}

  create(config: AgentConfig): AgentSession {
    const workspacePath = config.workspacePath ?? process.cwd();
    const resolved = { ...config, workspacePath };
    const adapter =
      this.dependencies.createAdapter?.(resolved) ??
      new PiRpcSessionAdapter(resolvePiAdapterOptions({ ...resolved, env: this.dependencies.env }));

    return new AgentSession(adapter);
  }
}
```

Modify `core/src/index.ts` to export:

```ts
export { AgentSession } from "./session/AgentSession.js";
export { AgentSessionFactory } from "./session/AgentSessionFactory.js";
```

- [ ] **Step 4: Run session factory tests and verify they pass**

Run:

```bash
pnpm --filter @potato/core test -- agent-session-factory
```

Expected: tests pass.

## Task 3: CLI Uses Core Session Factory

**Files:**
- Modify: `cli/src/commands/chat.ts`
- Modify: `cli/tests/chat-command.test.ts`

- [ ] **Step 1: Update failing chat test expectation**

Modify `cli/tests/chat-command.test.ts` to import `AgentSession` and pass a core session:

```ts
import { describe, expect, it, vi } from "vitest";
import { AgentSession, type PiSessionAdapter } from "@potato/core";
import { chatCommand } from "../src/commands/chat.js";
```

In the test options, replace `createSessionAdapter` with:

```ts
createSession: () => new AgentSession(adapter),
```

- [ ] **Step 2: Run chat tests and verify they fail**

Run:

```bash
pnpm --filter @potato/cli test -- chat-command
```

Expected: fails because `chatCommand` does not accept `createSession`.

- [ ] **Step 3: Update chat command to use core session factory**

Modify `cli/src/commands/chat.ts`:

```ts
import { input } from "@inquirer/prompts";
import { AgentSessionFactory, type AgentConfig, type AgentSession } from "@potato/core";
import { EventStreamRenderer } from "../ui/EventStreamRenderer.js";

export type ChatCommandOptions = AgentConfig & {
  createSession?: (options: AgentConfig) => AgentSession;
  read?: () => Promise<string>;
  write?: (line: string) => void;
};

export async function chatCommand(options: ChatCommandOptions = {}): Promise<void> {
  const workspacePath = options.workspacePath ?? process.cwd();
  const session = options.createSession
    ? options.createSession({ ...options, workspacePath })
    : new AgentSessionFactory().create({ ...options, workspacePath });
  const read = options.read ?? (() => input({ message: "你" }));
  const write = options.write ?? console.log;

  write(`进入交互会话：${options.provider ?? "未配置"}/${options.model ?? "未配置"}`);
  write("输入 /exit 退出。");

  await session.start();
  try {
    while (true) {
      const prompt = (await read()).trim();

      if (!prompt) {
        continue;
      }

      if (prompt === "/exit" || prompt === "/quit") {
        write("已退出交互会话。");
        break;
      }

      const renderer = new EventStreamRenderer();
      for await (const event of session.send(prompt)) {
        const rendered = renderer.render(event);
        if (rendered) {
          write(rendered);
        }

        if (event.type === "task.failed") {
          break;
        }
      }

      const remaining = renderer.flush();
      if (remaining) {
        write(remaining);
      }
    }
  } finally {
    await session.stop();
  }
}
```

- [ ] **Step 4: Run chat tests and verify they pass**

Run:

```bash
pnpm --filter @potato/cli test -- chat-command
```

Expected: tests pass.

## Task 4: Vue TUI Default Entry

> 历史注意：本任务下面的原始步骤仍保留了 Ink/React 示例代码，不再代表当前实现。当前实现使用 `cli/src/ui/AgentTui.ts` 中的 `@vue-tui/runtime` + Vue `defineComponent`，并由 `cli/src/commands/tui.tsx` 通过 `createApp(...).mount()` 启动。

**Files:**
- Modify: `cli/package.json`
- Create: `cli/src/ui/AgentTui.tsx`
- Create: `cli/src/commands/tui.tsx`
- Modify: `cli/src/cli.ts`
- Test: `cli/tests/tui-command.test.ts`

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm --filter @potato/cli add ink react
pnpm --filter @potato/cli add -D @types/react
```

Expected: dependencies added to `cli/package.json` and lockfile updated.

- [ ] **Step 2: Write failing TUI command tests**

Create `cli/tests/tui-command.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createTuiConfig, runTuiCommand } from "../src/commands/tui.js";

describe("createTuiConfig", () => {
  it("defaults workspace to the current process directory", () => {
    expect(createTuiConfig({ cwd: "/repo" })).toEqual({ workspacePath: "/repo" });
  });

  it("uses provided runtime model config", () => {
    expect(
      createTuiConfig({
        cwd: "/repo",
        provider: "deepseek",
        model: "deepseek-reasoner",
        apiKey: "secret"
      })
    ).toEqual({
      workspacePath: "/repo",
      provider: "deepseek",
      model: "deepseek-reasoner",
      apiKey: "secret"
    });
  });
});

describe("runTuiCommand", () => {
  it("passes normalized config to renderer", async () => {
    const render = vi.fn();
    await runTuiCommand({ cwd: "/repo", provider: "deepseek", model: "deepseek-chat" }, { render });

    expect(render).toHaveBeenCalledWith(expect.objectContaining({ workspacePath: "/repo", provider: "deepseek" }));
  });
});
```

- [ ] **Step 3: Run TUI tests and verify they fail**

Run:

```bash
pnpm --filter @potato/cli test -- tui-command
```

Expected: fails because `commands/tui` does not exist.

- [ ] **Step 4: Implement TUI command and component**

Create `cli/src/ui/AgentTui.tsx`:

```tsx
import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentConfig, AgentSession } from "@potato/core";
import { EventStreamRenderer } from "./EventStreamRenderer.js";

export type AgentTuiProps = {
  config: AgentConfig;
  createSession?: (config: AgentConfig) => AgentSession;
};

export function AgentTui({ config }: AgentTuiProps): React.ReactElement {
  const { exit } = useApp();
  const [lines, setLines] = useState<string[]>([
    `workspace: ${config.workspacePath ?? process.cwd()}`,
    `model: ${config.provider ?? "未配置"}/${config.model ?? "未配置"}`,
    "输入 /exit 退出，/workspace 查看工作区，/model 查看模型配置。"
  ]);
  const [draft, setDraft] = useState("");

  useInput((input, key) => {
    if (key.return) {
      const prompt = draft.trim();
      setDraft("");

      if (prompt === "/exit" || prompt === "/quit") {
        exit();
        return;
      }

      if (prompt === "/workspace") {
        setLines((current) => [...current, `workspace: ${config.workspacePath ?? process.cwd()}`]);
        return;
      }

      if (prompt === "/model") {
        setLines((current) => [...current, `model: ${config.provider ?? "未配置"}/${config.model ?? "未配置"}`]);
        return;
      }

      if (prompt) {
        const renderer = new EventStreamRenderer({ colors: false });
        setLines((current) => [...current, `你：${prompt}`, renderer.render({ type: "step.started", taskId: "tui", title: "等待发送到 Agent 会话" })]);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setDraft((current) => current.slice(0, -1));
      return;
    }

    if (input) {
      setDraft((current) => `${current}${input}`);
    }
  });

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" paddingX={1}>
        <Text>Agent | {config.workspacePath ?? process.cwd()} | {config.provider ?? "未配置"}/{config.model ?? "未配置"}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {lines.slice(-20).map((line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text>› {draft}</Text>
      </Box>
    </Box>
  );
}
```

Create `cli/src/commands/tui.tsx`:

```tsx
import React from "react";
import { render } from "ink";
import type { AgentConfig } from "@potato/core";
import { AgentTui } from "../ui/AgentTui.js";

export type TuiCommandOptions = AgentConfig & {
  cwd?: string;
};

export type TuiCommandDependencies = {
  render?: (config: AgentConfig) => void | Promise<void>;
};

export function createTuiConfig(options: TuiCommandOptions = {}): AgentConfig {
  return {
    workspacePath: options.workspacePath ?? options.cwd ?? process.cwd(),
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs
  };
}

export async function runTuiCommand(options: TuiCommandOptions = {}, dependencies: TuiCommandDependencies = {}): Promise<void> {
  const config = createTuiConfig(options);

  if (dependencies.render) {
    await dependencies.render(config);
    return;
  }

  render(<AgentTui config={config} />);
}
```

- [ ] **Step 5: Modify TypeScript configs for JSX**

Modify `cli/tsconfig.json` compiler options to include:

```json
"jsx": "react-jsx"
```

- [ ] **Step 6: Modify CLI default action**

Modify `cli/src/cli.ts`:

```ts
import { runTuiCommand } from "./commands/tui.js";
```

Add options to the root program:

```ts
program
  .option("--provider <provider>", "模型供应商，例如 deepseek")
  .option("--model <model>", "模型名称，例如 deepseek-reasoner")
  .option("--api-key <apiKey>", "模型 API Key，也可使用对应环境变量")
  .option("--timeout-ms <ms>", "Pi RPC 每轮等待超时时间", "120000")
  .action(async (options: Record<string, string>) => {
    try {
      await runTuiCommand({
        provider: options.provider,
        model: options.model,
        apiKey: options.apiKey,
        timeoutMs: Number(options.timeoutMs),
        cwd: process.cwd()
      });
    } catch (error) {
      console.error(formatCliError(error));
      process.exitCode = 1;
    }
  });
```

- [ ] **Step 7: Run TUI tests and verify they pass**

Run:

```bash
pnpm --filter @potato/cli test -- tui-command
```

Expected: tests pass.

## Task 5: Workspace Docs and Verification

**Files:**
- Modify: `wiki/project-state.md`
- Modify: `wiki/technical-plan-mvp.md`

- [ ] **Step 1: Mark M4 implementation result in wiki**

Update `wiki/project-state.md` M4 section with:

```text
状态：已完成。

验证结果：

- `pnpm typecheck` 通过。
- `pnpm test` 通过。
- `pnpm build` 通过。
- `pnpm --filter @potato/cli dev --help` 可看到默认入口和兼容命令。
```

- [ ] **Step 2: Run full workspace verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @potato/cli dev --help
```

Expected: all commands pass.

- [ ] **Step 3: Commit**

Run:

```bash
git add .
git commit -m "feat: add tui entry and core session config"
```

Expected: commit succeeds.

## Self-Review

- Spec coverage: covers TUI default entry, runtime model config, default workspace, core config/session convergence, compatibility commands, and wiki maintenance.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: `AgentConfig`, `AgentSession`, `AgentSessionFactory`, `FileAgentConfigStore`, and `runTuiCommand` names are consistent across tasks.
