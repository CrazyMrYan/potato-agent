# 第一阶段技术方案

## 目标

第一阶段目标是做出一个可实战验证的 CLI 编码智能体 MVP。

这个 MVP 不追求桌面端 UI，也不追求完整产品化能力。它只验证核心闭环：

```text
输入任务
创建任务上下文
经过智能体编排层调度
调用 Pi 执行 agent loop
通过工具边界访问本地仓库
展示进度
展示 diff
请求确认
运行验证
输出总结
记录 trace
```

## 技术路线

采用“独立仓库 + 进程内 Pi + 协议边界先行”的路线。

第一版运行形态：

```text
coding-agent-cli
  -> AgentGateway
  -> AgentOrchestrator
  -> InProcessPiAdapter
  -> Pi SDK
  -> Tool Boundary
  -> 本地文件 / Git / Shell / 搜索
```

后续可演进形态：

```text
coding-agent-cli / coding-agent-desktop
  -> AgentGateway
  -> AgentOrchestrator
  -> RpcPiAdapter
  -> coding-agent-runtime 子进程
  -> Pi SDK
  -> Tool Boundary
```

第一阶段只实现进程内 Pi 适配器，但接口上保留 runtime 拆分能力。

## 仓库拆分

当前仓库 `coding-agent` 继续作为知识库和总控仓库，不放第一阶段实现代码。

第一阶段建议新建两个实现仓库：

```text
coding-agent-protocol
  定义稳定协议、事件、任务输入、权限请求、diff 数据结构。
  不依赖 Pi，不依赖 CLI。

coding-agent-cli
  第一阶段可执行产品。
  依赖 coding-agent-protocol。
  内部包含 AgentGateway、AgentOrchestrator、InProcessPiAdapter、Tool Boundary。
```

暂不单独拆 `coding-agent-runtime`。等进程内方案跑通，再把 Pi runtime 拆成独立仓库。

原因：

- `protocol` 必须独立，因为它是 CLI、桌面端、runtime 的共同边界。
- `cli` 是第一阶段唯一宿主，可以先承载编排层和工具层，减少仓库数量。
- `runtime` 过早拆分会增加进程通信、版本管理和调试成本。

## 技术栈

| 层级 | 技术选择 | 说明 |
| --- | --- | --- |
| 语言 | TypeScript | 适合 CLI、协议、Node 工具层和后续桌面端复用 |
| 运行时 | Node.js | 便于接入文件系统、Git、Shell、Pi SDK |
| 包管理 | pnpm | 适合后续 workspace，但独立仓库也可单独使用 |
| CLI 框架 | commander | 命令解析简单稳定 |
| 终端输出 | picocolors + 自定义 renderer | 第一版不引入复杂 TUI |
| 交互确认 | @inquirer/prompts | 用于写文件、执行命令、删除文件等确认 |
| diff 生成 | git diff 优先 | 以 Git 作为变更边界，避免自己实现 diff |
| 搜索 | ripgrep 调用 | 直接复用开发者环境中成熟工具 |
| trace | JSONL 文件 | 流式写入，便于复盘和调试 |
| 测试 | Vitest | TypeScript 项目启动成本低 |

## coding-agent-protocol

### 职责

`coding-agent-protocol` 只定义类型和协议，不实现业务逻辑。

它负责：

- 任务输入
- 事件模型
- 权限请求
- 工具调用摘要
- diff 数据结构
- trace 事件结构
- 错误码

它不负责：

- 调用 Pi
- 读写文件
- 执行命令
- 展示 CLI
- 记录 trace 文件

### 目录结构

```text
coding-agent-protocol/
  package.json
  tsconfig.json
  src/
    index.ts
    task.ts
    events.ts
    approval.ts
    changeset.ts
    errors.ts
```

### 核心类型

```ts
export type RunTaskInput = {
  taskId: string;
  workspacePath: string;
  prompt: string;
  mode: "run";
  approvalMode: "manual" | "auto-readonly";
};
```

```ts
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

```ts
export type ChangeSet = {
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed";
    diff?: string;
  }>;
};
```

```ts
export type ApprovalRequest = {
  id: string;
  taskId: string;
  kind: "write_file" | "run_command" | "delete_file";
  title: string;
  detail: string;
  risk: "low" | "medium" | "high";
};
```

## coding-agent-cli

### 职责

`coding-agent-cli` 是第一阶段验证壳。

它负责：

- 提供 `agent run "<任务描述>"`。
- 提供 `agent diff`。
- 提供 `agent trace`。
- 展示标准化事件流。
- 处理用户确认。
- 落盘 trace。
- 调用 AgentGateway。

它不应该直接调用 Pi。所有 Pi 相关能力必须经过 `AgentOrchestrator -> PiAdapter`。

### 目录结构

```text
coding-agent-cli/
  package.json
  tsconfig.json
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
```

## 模块设计

### AgentGateway

`AgentGateway` 是宿主入口。CLI 只依赖它。

```ts
export interface AgentGateway {
  runTask(input: RunTaskInput): AsyncIterable<AgentEvent>;
  cancelTask(taskId: string): Promise<void>;
}
```

第一版实现：

```text
LocalAgentGateway
  -> AgentOrchestrator
```

### AgentOrchestrator

`AgentOrchestrator` 是第一阶段最重要的自有能力层。

它负责：

- 创建任务上下文。
- 写入 `TaskStarted`。
- 调用 `PiAdapter`。
- 接收 Pi 事件。
- 调用权限策略。
- 调用工具边界。
- 记录 trace。
- 生成最终总结事件。

核心方法：

```ts
export class AgentOrchestrator {
  run(input: RunTaskInput): AsyncIterable<AgentEvent>;
  cancel(taskId: string): Promise<void>;
}
```

### PiAdapter

Pi 只通过适配器进入系统。

```ts
export interface PiAdapter {
  run(input: PiRunInput): AsyncIterable<PiAdapterEvent>;
}
```

第一版：

```text
InProcessPiAdapter
  -> 调用 Pi SDK
  -> 注册工具
  -> 把 Pi 输出转换成 PiAdapterEvent
```

后续：

```text
RpcPiAdapter
  -> 调用本地 runtime 子进程
  -> 通过 JSON event stream 传输事件
```

### Tool Boundary

工具边界统一接管本地能力。

第一版工具：

| 工具 | 能力 | 默认权限 |
| --- | --- | --- |
| file.read | 读取文件 | 允许 |
| file.write | 写文件或 patch | 需要确认 |
| search.rg | 搜索代码 | 允许 |
| git.status | 查看状态 | 允许 |
| git.diff | 查看 diff | 允许 |
| shell.run | 执行命令 | 需要确认 |

所有工具调用都要生成事件：

```text
ToolCallStarted
ToolCallFinished
TaskFailed
```

写操作和命令执行前必须经过 `ApprovalRequested`。

### Trace Store

第一版 trace 写入当前工作目录：

```text
<workspace>/.coding-agent/traces/<task-id>.jsonl
```

每行一个 JSON 事件。

示例：

```json
{"type":"task.started","taskId":"task_123","workspacePath":"/repo","prompt":"修复测试失败"}
{"type":"tool.started","taskId":"task_123","tool":"git.status"}
{"type":"diff.produced","taskId":"task_123","files":[{"path":"src/a.ts","status":"modified"}]}
{"type":"task.finished","taskId":"task_123","summary":"已修复测试失败"}
```

## CLI 行为

### agent run

```bash
agent run "修复测试失败"
```

行为：

1. 检查当前目录。
2. 创建 task id。
3. 创建 `RunTaskInput`。
4. 调用 `AgentGateway.runTask()`。
5. 渲染事件流。
6. 遇到确认事件时阻塞等待用户输入。
7. 任务结束后显示总结。

### agent diff

```bash
agent diff
```

行为：

1. 调用 `git diff --stat`。
2. 调用 `git diff`。
3. 输出当前工作区 diff。

第一版直接展示 Git diff，不做复杂 diff UI。

### agent trace

```bash
agent trace
```

行为：

1. 找到最近一个 trace 文件。
2. 按时间顺序读取 JSONL。
3. 展示任务摘要、工具调用、确认请求、diff、验证结果。

## 权限策略

第一版权限策略必须简单、明确、可测试。

```text
读取文件：允许
搜索代码：允许
查看 Git：允许
写文件：确认
执行命令：确认
删除文件：强确认
Git 提交：不支持
```

`ApprovalPolicy` 输入工具动作，输出是否需要确认：

```ts
type ApprovalDecision =
  | { type: "allow" }
  | { type: "request_approval"; request: ApprovalRequest }
  | { type: "deny"; reason: string };
```

## 错误处理

错误必须转换成事件，不直接抛到 CLI 顶层。

第一版错误码：

| 错误码 | 含义 |
| --- | --- |
| `WORKSPACE_NOT_FOUND` | 工作目录不存在 |
| `NOT_GIT_REPOSITORY` | 当前目录不是 Git 仓库 |
| `PI_INIT_FAILED` | Pi 初始化失败 |
| `TOOL_FAILED` | 工具执行失败 |
| `APPROVAL_REJECTED` | 用户拒绝确认 |
| `COMMAND_FAILED` | Shell 命令失败 |
| `TASK_CANCELLED` | 任务被取消 |
| `UNKNOWN_ERROR` | 未知异常 |

## 测试策略

第一阶段优先测试自有边界，不测试 Pi 内部行为。

必须覆盖：

- `coding-agent-protocol` 类型导出。
- `ApprovalPolicy` 对不同工具动作的决策。
- `AgentOrchestrator` 能把 PiAdapter 模拟事件转换成 AgentEvent。
- `JsonlTraceStore` 能写入和读取 JSONL。
- `renderEvent` 能处理所有 AgentEvent 类型。

Pi 相关测试用 fake adapter：

```text
FakePiAdapter
  输出固定事件流
  不调用真实模型
```

这样第一阶段可以在没有真实模型配置时跑通核心测试。

## 里程碑

### M1：协议仓库

产物：

- `coding-agent-protocol` 仓库。
- 核心类型定义。
- 类型导出测试。

验收：

- `pnpm test` 通过。
- CLI 仓库可以依赖并导入协议类型。

### M2：CLI 骨架

产物：

- `coding-agent-cli` 仓库。
- `agent run` 命令。
- `LocalAgentGateway`。
- `AgentOrchestrator`。
- `FakePiAdapter`。
- 模拟事件流渲染。

验收：

- 运行 `agent run "测试任务"` 可以看到完整模拟流程。
- 不需要真实 Pi。

### M3：Trace 和 diff

产物：

- `JsonlTraceStore`。
- `agent trace`。
- `agent diff`。
- Git diff 展示。

验收：

- 每次 `agent run` 都产生 trace 文件。
- `agent trace` 可以读取最近任务。
- `agent diff` 能展示当前工作区变更。

### M4：工具边界

产物：

- 文件读取工具。
- 搜索工具。
- Git 工具。
- Shell 工具。
- 权限策略。
- 用户确认流程。

验收：

- 读文件、搜索、Git 状态默认允许。
- 写文件和执行命令必须出现确认。
- 拒绝确认会产生 `TaskFailed` 或可恢复事件。

### M5：接入 Pi

产物：

- `InProcessPiAdapter`。
- Pi SDK 初始化。
- 工具注册。
- Pi 事件转换。

验收：

- `agent run "<真实任务>"` 能通过 Pi 读取仓库、提出或执行变更。
- CLI 能展示进度和 diff。
- trace 能记录关键过程。

## 第一阶段不做

- 桌面端。
- 复杂 TUI。
- 多智能体。
- 云端执行。
- 容器沙箱。
- 自动 Git 提交。
- 插件市场。
- 多语言 UI。
- 独立 runtime 子进程。

## 风险和应对

| 风险 | 应对 |
| --- | --- |
| Pi SDK 事件模型和预期不一致 | 用 `PiAdapter` 隔离，只把稳定事件输出给 Orchestrator |
| 工具权限边界不清 | 所有工具都必须经过 `Tool Boundary` 和 `ApprovalPolicy` |
| 真实模型调试成本高 | M1-M4 使用 `FakePiAdapter` 先跑通自有链路 |
| diff 展示复杂化 | 第一版只使用 Git diff |
| trace 后续查询需求变复杂 | 第一版 JSONL，后续再迁移 SQLite |

## 验收标准

第一阶段完成时，应满足：

- 可以在一个本地 Git 仓库中运行 `agent run "<任务>"`。
- CLI 能展示任务进展。
- CLI 能展示 diff。
- 写文件和执行命令前能请求确认。
- 能运行验证命令并展示结果。
- 每次任务都有 JSONL trace。
- 核心测试不依赖真实 Pi 或真实模型即可通过。

## 下一步

下一步不是直接做桌面端，而是先创建 `coding-agent-protocol` 和 `coding-agent-cli` 两个实现仓库。

推荐执行顺序：

1. 初始化 `coding-agent-protocol`。
2. 定义协议类型和测试。
3. 初始化 `coding-agent-cli`。
4. 用 `FakePiAdapter` 跑通 CLI 事件流。
5. 加 trace、diff、权限和工具边界。
6. 最后接入真实 Pi。
