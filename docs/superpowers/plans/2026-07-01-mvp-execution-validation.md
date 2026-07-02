# MVP Execution Validation Implementation Plan

> 历史计划：这份计划记录 M1-M2 时期的 sibling repo 执行方案。当前项目已经迁入单一 pnpm workspace，实际结构以 `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/{wiki,protocol,core,cli}` 为准。继续执行前先看 `wiki/project-state.md` 和 `wiki/technical-plan-mvp.md`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate the first CLI-based coding agent MVP across `coding-agent-protocol` and `coding-agent-cli`, proving the agent event loop before desktop work.

**Architecture:** `coding-agent-protocol` owns stable task, event, approval, changeset, and error types. `coding-agent-cli` owns the CLI host, AgentGateway, AgentOrchestrator, FakePiAdapter/InProcessPiAdapter boundary, Tool Boundary, Trace Store, and event rendering. Pi is treated as a bottom execution engine; project-specific capability lives in AgentOrchestrator.

**Tech Stack:** TypeScript, Node.js, pnpm, commander, Vitest, picocolors, @inquirer/prompts, Git CLI, ripgrep, JSONL trace files.

---

## Context

This plan executes the current project phase described in:

- `wiki/project-state.md`
- `wiki/architecture.md`
- `wiki/technical-design.md`
- `wiki/technical-plan-mvp.md`

The current repository remains the knowledge base and control repository. Implementation should happen in sibling repositories:

```text
/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol
/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli
```

Whenever architecture, phase status, milestones, repository split, module responsibility, validation result, or implementation scope changes, update `wiki/` in this repository in the same working session.

## File Structure

Create `coding-agent-protocol`:

```text
coding-agent-protocol/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts
    task.ts
    events.ts
    approval.ts
    changeset.ts
    errors.ts
  tests/
    exports.test.ts
```

Create `coding-agent-cli`:

```text
coding-agent-cli/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    cli.ts
    commands/
      run.ts
      diff.ts
      trace.ts
    gateway/
      AgentGateway.ts
      LocalAgentGateway.ts
    orchestrator/
      AgentOrchestrator.ts
      approvalPolicy.ts
      budgetPolicy.ts
      verificationPolicy.ts
      contextPolicy.ts
    pi/
      PiAdapter.ts
      FakePiAdapter.ts
      InProcessPiAdapter.ts
    tools/
      ToolBoundary.ts
      fileTools.ts
      gitTools.ts
      searchTools.ts
      shellTools.ts
    trace/
      TraceStore.ts
      JsonlTraceStore.ts
    ui/
      renderEvent.ts
      promptApproval.ts
    errors/
      mapError.ts
  tests/
    protocol-contract.test.ts
    orchestrator.test.ts
    approval-policy.test.ts
    trace-store.test.ts
    render-event.test.ts
```

Update this knowledge repository:

```text
coding-agent/
  wiki/
    project-state.md
    technical-plan-mvp.md
```

## Task 1: Create `coding-agent-protocol`

**Files:**
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/package.json`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/tsconfig.json`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/vitest.config.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/task.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/changeset.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/approval.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/errors.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/events.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/index.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/tests/exports.test.ts`

- [ ] **Step 1: Initialize repository**

Run:

```bash
cd /Users/yanjiahui/Desktop
mkdir coding-agent-protocol
cd coding-agent-protocol
git init
git branch -m main
pnpm init
pnpm add -D typescript vitest tsx @types/node
```

Expected: repository exists on `main`, dependencies are installed.

- [ ] **Step 2: Write package config**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/package.json`:

```json
{
  "name": "@coding-agent/protocol",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Write TypeScript config**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
```

- [ ] **Step 4: Write protocol types**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/task.ts`:

```ts
export type TaskMode = "run";
export type ApprovalMode = "manual" | "auto-readonly";

export type RunTaskInput = {
  taskId: string;
  workspacePath: string;
  prompt: string;
  mode: TaskMode;
  approvalMode: ApprovalMode;
};
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/changeset.ts`:

```ts
export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export type ChangeSet = {
  files: Array<{
    path: string;
    status: FileChangeStatus;
    diff?: string;
  }>;
};
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/approval.ts`:

```ts
export type ApprovalKind = "write_file" | "run_command" | "delete_file";
export type ApprovalRisk = "low" | "medium" | "high";

export type ApprovalRequest = {
  id: string;
  taskId: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  risk: ApprovalRisk;
};

export type ApprovalDecision =
  | { type: "allow" }
  | { type: "request_approval"; request: ApprovalRequest }
  | { type: "deny"; reason: string };
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/errors.ts`:

```ts
export type AgentErrorCode =
  | "WORKSPACE_NOT_FOUND"
  | "NOT_GIT_REPOSITORY"
  | "PI_INIT_FAILED"
  | "TOOL_FAILED"
  | "APPROVAL_REJECTED"
  | "COMMAND_FAILED"
  | "TASK_CANCELLED"
  | "UNKNOWN_ERROR";

export type AgentError = {
  code: AgentErrorCode;
  message: string;
  cause?: string;
};
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/events.ts`:

```ts
import type { ApprovalRequest } from "./approval.js";
import type { ChangeSet } from "./changeset.js";
import type { AgentError } from "./errors.js";

export type TaskStartedEvent = {
  type: "task.started";
  taskId: string;
  workspacePath: string;
  prompt: string;
};

export type StepStartedEvent = {
  type: "step.started";
  taskId: string;
  title: string;
};

export type ToolCallStartedEvent = {
  type: "tool.started";
  taskId: string;
  tool: string;
  summary: string;
};

export type ToolCallFinishedEvent = {
  type: "tool.finished";
  taskId: string;
  tool: string;
  success: boolean;
  output?: string;
};

export type ApprovalRequestedEvent = {
  type: "approval.requested";
  taskId: string;
  request: ApprovalRequest;
};

export type DiffProducedEvent = {
  type: "diff.produced";
  taskId: string;
  changeSet: ChangeSet;
};

export type VerificationStartedEvent = {
  type: "verification.started";
  taskId: string;
  command: string;
};

export type VerificationFinishedEvent = {
  type: "verification.finished";
  taskId: string;
  command: string;
  exitCode: number;
  output: string;
};

export type TaskFinishedEvent = {
  type: "task.finished";
  taskId: string;
  summary: string;
};

export type TaskFailedEvent = {
  type: "task.failed";
  taskId: string;
  error: AgentError;
};

export type AgentEvent =
  | TaskStartedEvent
  | StepStartedEvent
  | ToolCallStartedEvent
  | ToolCallFinishedEvent
  | ApprovalRequestedEvent
  | DiffProducedEvent
  | VerificationStartedEvent
  | VerificationFinishedEvent
  | TaskFinishedEvent
  | TaskFailedEvent;
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/src/index.ts`:

```ts
export type { ApprovalDecision, ApprovalKind, ApprovalRequest, ApprovalRisk } from "./approval.js";
export type { ChangeSet, FileChangeStatus } from "./changeset.js";
export type { AgentError, AgentErrorCode } from "./errors.js";
export type {
  AgentEvent,
  ApprovalRequestedEvent,
  DiffProducedEvent,
  StepStartedEvent,
  TaskFailedEvent,
  TaskFinishedEvent,
  TaskStartedEvent,
  ToolCallFinishedEvent,
  ToolCallStartedEvent,
  VerificationFinishedEvent,
  VerificationStartedEvent
} from "./events.js";
export type { ApprovalMode, RunTaskInput, TaskMode } from "./task.js";
```

- [ ] **Step 5: Write export test**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol/tests/exports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent, ApprovalDecision, ChangeSet, RunTaskInput } from "../src/index.js";

describe("protocol exports", () => {
  it("defines task, event, approval, and changeset contracts", () => {
    const input: RunTaskInput = {
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "修复测试失败",
      mode: "run",
      approvalMode: "manual"
    };

    const decision: ApprovalDecision = { type: "allow" };
    const changeSet: ChangeSet = { files: [{ path: "src/a.ts", status: "modified" }] };
    const event: AgentEvent = { type: "task.started", taskId: input.taskId, workspacePath: input.workspacePath, prompt: input.prompt };

    expect(input.mode).toBe("run");
    expect(decision.type).toBe("allow");
    expect(changeSet.files[0]?.status).toBe("modified");
    expect(event.type).toBe("task.started");
  });
});
```

- [ ] **Step 6: Verify protocol**

Run:

```bash
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol
pnpm test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit protocol**

Run:

```bash
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol
git add .
git commit -m "feat: initialize protocol contracts"
```

Expected: commit succeeds.

## Task 2: Create CLI Skeleton With FakePiAdapter

**Files:**
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/package.json`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/tsconfig.json`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/vitest.config.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/cli.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/gateway/AgentGateway.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/gateway/LocalAgentGateway.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/orchestrator/AgentOrchestrator.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/pi/PiAdapter.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/pi/FakePiAdapter.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/commands/run.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/ui/renderEvent.ts`
- Create: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/tests/orchestrator.test.ts`

- [ ] **Step 1: Initialize repository**

Run:

```bash
cd /Users/yanjiahui/Desktop
mkdir coding-agent-cli
cd coding-agent-cli
git init
git branch -m main
pnpm init
pnpm add commander picocolors @inquirer/prompts
pnpm add -D typescript vitest tsx @types/node
```

Expected: repository exists on `main`, dependencies are installed.

- [ ] **Step 2: Add local protocol dependency**

Edit `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/package.json`:

```json
{
  "name": "@coding-agent/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "agent": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@coding-agent/protocol": "file:../coding-agent-protocol",
    "@inquirer/prompts": "^7.0.0",
    "commander": "^14.0.0",
    "picocolors": "^1.1.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Add TypeScript and Vitest config**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"]
  }
});
```

- [ ] **Step 4: Write adapter and orchestrator contracts**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/pi/PiAdapter.ts`:

```ts
import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";

export type PiAdapterEvent = AgentEvent;

export interface PiAdapter {
  run(input: RunTaskInput): AsyncIterable<PiAdapterEvent>;
}
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/pi/FakePiAdapter.ts`:

```ts
import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import type { PiAdapter } from "./PiAdapter.js";

export class FakePiAdapter implements PiAdapter {
  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    yield { type: "step.started", taskId: input.taskId, title: "创建任务上下文" };
    yield { type: "tool.started", taskId: input.taskId, tool: "git.status", summary: "读取 Git 状态" };
    yield { type: "tool.finished", taskId: input.taskId, tool: "git.status", success: true, output: "工作区干净" };
    yield { type: "diff.produced", taskId: input.taskId, changeSet: { files: [] } };
    yield { type: "task.finished", taskId: input.taskId, summary: "模拟任务完成，尚未接入真实 Pi" };
  }
}
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/orchestrator/AgentOrchestrator.ts`:

```ts
import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import type { PiAdapter } from "../pi/PiAdapter.js";

export class AgentOrchestrator {
  constructor(private readonly piAdapter: PiAdapter) {}

  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    yield {
      type: "task.started",
      taskId: input.taskId,
      workspacePath: input.workspacePath,
      prompt: input.prompt
    };

    for await (const event of this.piAdapter.run(input)) {
      yield event;
    }
  }

  async cancel(_taskId: string): Promise<void> {
    return;
  }
}
```

- [ ] **Step 5: Write gateway**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/gateway/AgentGateway.ts`:

```ts
import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";

export interface AgentGateway {
  runTask(input: RunTaskInput): AsyncIterable<AgentEvent>;
  cancelTask(taskId: string): Promise<void>;
}
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/gateway/LocalAgentGateway.ts`:

```ts
import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import { AgentOrchestrator } from "../orchestrator/AgentOrchestrator.js";
import type { AgentGateway } from "./AgentGateway.js";

export class LocalAgentGateway implements AgentGateway {
  constructor(private readonly orchestrator: AgentOrchestrator) {}

  runTask(input: RunTaskInput): AsyncIterable<AgentEvent> {
    return this.orchestrator.run(input);
  }

  cancelTask(taskId: string): Promise<void> {
    return this.orchestrator.cancel(taskId);
  }
}
```

- [ ] **Step 6: Write CLI rendering and run command**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/ui/renderEvent.ts`:

```ts
import pc from "picocolors";
import type { AgentEvent } from "@coding-agent/protocol";

export function renderEvent(event: AgentEvent): string {
  switch (event.type) {
    case "task.started":
      return pc.cyan(`收到任务：${event.prompt}`);
    case "step.started":
      return pc.blue(`步骤：${event.title}`);
    case "tool.started":
      return pc.gray(`工具开始：${event.tool} - ${event.summary}`);
    case "tool.finished":
      return event.success ? pc.green(`工具完成：${event.tool}`) : pc.red(`工具失败：${event.tool}`);
    case "approval.requested":
      return pc.yellow(`需要确认：${event.request.title}`);
    case "diff.produced":
      return pc.magenta(`产生 diff：${event.changeSet.files.length} 个文件`);
    case "verification.started":
      return pc.gray(`开始验证：${event.command}`);
    case "verification.finished":
      return event.exitCode === 0 ? pc.green(`验证通过：${event.command}`) : pc.red(`验证失败：${event.command}`);
    case "task.finished":
      return pc.green(`任务完成：${event.summary}`);
    case "task.failed":
      return pc.red(`任务失败：${event.error.code} ${event.error.message}`);
  }
}
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/commands/run.ts`:

```ts
import type { RunTaskInput } from "@coding-agent/protocol";
import { LocalAgentGateway } from "../gateway/LocalAgentGateway.js";
import { AgentOrchestrator } from "../orchestrator/AgentOrchestrator.js";
import { FakePiAdapter } from "../pi/FakePiAdapter.js";
import { renderEvent } from "../ui/renderEvent.js";

export async function runCommand(prompt: string): Promise<void> {
  const taskId = `task_${Date.now()}`;
  const input: RunTaskInput = {
    taskId,
    workspacePath: process.cwd(),
    prompt,
    mode: "run",
    approvalMode: "manual"
  };

  const gateway = new LocalAgentGateway(new AgentOrchestrator(new FakePiAdapter()));

  for await (const event of gateway.runTask(input)) {
    console.log(renderEvent(event));
  }
}
```

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/src/cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from "commander";
import { runCommand } from "./commands/run.js";

const program = new Command();

program.name("agent").description("编码智能体 CLI").version("0.1.0");

program
  .command("run")
  .argument("<prompt>", "任务描述")
  .action(async (prompt: string) => {
    await runCommand(prompt);
  });

await program.parseAsync(process.argv);
```

- [ ] **Step 7: Write orchestrator test**

Create `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli/tests/orchestrator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../src/orchestrator/AgentOrchestrator.js";
import { FakePiAdapter } from "../src/pi/FakePiAdapter.js";

describe("AgentOrchestrator", () => {
  it("emits task started and fake adapter events", async () => {
    const orchestrator = new AgentOrchestrator(new FakePiAdapter());
    const events = [];

    for await (const event of orchestrator.run({
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "测试任务",
      mode: "run",
      approvalMode: "manual"
    })) {
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
});
```

- [ ] **Step 8: Verify CLI skeleton**

Run:

```bash
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli
pnpm install
pnpm test
pnpm typecheck
pnpm dev run "测试任务"
```

Expected: tests and typecheck pass; CLI prints the simulated event flow.

- [ ] **Step 9: Commit CLI skeleton**

Run:

```bash
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli
git add .
git commit -m "feat: initialize cli skeleton"
```

Expected: commit succeeds.

## Task 3: Record First Validation Result In Wiki

**Files:**
- Modify: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/wiki/project-state.md`
- Modify: `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/wiki/technical-plan-mvp.md`

- [ ] **Step 1: Update project phase status**

Modify `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/wiki/project-state.md` after Task 1 and Task 2 complete. Add this section:

````markdown
## 执行验证记录

### M1-M2：协议仓库和 CLI 骨架

状态：已完成

验证命令：

```text
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol && pnpm test && pnpm typecheck && pnpm build
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli && pnpm test && pnpm typecheck && pnpm dev run "测试任务"
```

结果：

- `coding-agent-protocol` 类型、测试和构建通过。
- `coding-agent-cli` 可以通过 `FakePiAdapter` 输出完整模拟事件流。
- 当前还没有接入 trace、diff、权限策略和真实 Pi。

下一步：

- 为 trace、diff、权限策略和工具边界分别写执行计划。
````

- [ ] **Step 2: Update MVP technical plan milestone status**

Modify `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/wiki/technical-plan-mvp.md`. Under `## 里程碑`, add this status summary before `### M1：协议仓库`:

```markdown
当前执行状态：

- M1：待执行
- M2：待执行
- M3：待规划
- M4：待规划
- M5：待规划
```

After Task 1 and Task 2 complete, change M1 and M2 to `已完成`.

- [ ] **Step 3: Verify wiki formatting**

Run:

```bash
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent
git diff --check
rg -n 'TO''DO|TB''D|待''定|占''位' wiki docs || true
```

Expected: no whitespace errors and no placeholder terms.

- [ ] **Step 4: Commit validation docs**

Run:

```bash
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent
git add wiki/project-state.md wiki/technical-plan-mvp.md
git commit -m "docs: record MVP validation progress"
```

Expected: commit succeeds.

## Follow-Up Plans

Create separate Superpowers plans after this one is complete:

- `trace-and-diff.md`: implement `JsonlTraceStore`, `agent trace`, and `agent diff`.
- `tool-boundary-and-approval.md`: implement Tool Boundary, approval policy, file/search/git/shell tools.
- `pi-integration.md`: implement `InProcessPiAdapter` and real Pi SDK integration.

## Self-Review Checklist

- [ ] Every implementation repository has a concrete file structure.
- [ ] Every milestone in this plan produces testable software.
- [ ] Protocol is independent of CLI and Pi.
- [ ] CLI does not call Pi directly.
- [ ] AgentOrchestrator is the home for product capability.
- [ ] FakePiAdapter allows validation without real model credentials.
- [ ] Wiki maintenance is required whenever phase information changes.
- [ ] No desktop UI work appears in this phase.
