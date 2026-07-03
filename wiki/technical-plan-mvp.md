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

采用“单仓库 workspace + Pi RPC 接入 + 协议边界先行”的路线。

第一版运行形态：

```text
cli/
  -> AgentGateway
  -> AgentOrchestrator
  -> PiRpcAdapter
  -> @earendil-works/pi-coding-agent RpcClient
  -> Pi RPC 子进程
  -> Tool Boundary
  -> 本地文件 / Git / Shell / 搜索
```

后续可演进形态：

```text
cli/ / desktop/
  -> AgentGateway
  -> AgentOrchestrator
  -> RuntimePiAdapter
  -> coding-agent-runtime 子进程
  -> Pi SDK
  -> Tool Boundary
```

第一阶段先使用 Pi SDK 已提供的 `RpcClient` 启动 Pi RPC 子进程。这样可以更早验证真实 Pi 路径，同时仍保留后续拆出独立 `coding-agent-runtime` 仓库的能力。

## 工作区拆分

当前仓库 `coding-agent` 是单一 Git 仓库，使用 pnpm workspace 管理模块。

当前目录结构：

```text
coding-agent/
  wiki/      知识库和阶段记录
  protocol/  @coding-agent/protocol，稳定协议和类型契约
  core/      @coding-agent/core，AgentGateway、AgentOrchestrator、PiAdapter、工具边界
  cli/       @coding-agent/cli，命令解析、终端交互和渲染
```

暂不单独拆 `coding-agent-runtime`。等 Pi RPC 路径跑通并完成真实任务验证，再从 `core/` 抽出本项目 runtime 子进程。

原因：

- `protocol/` 必须保持纯契约，因为它是 CLI、桌面端、runtime 的共同边界。
- `core/` 承载可复用核心能力，避免 CLI 变成事实核心层。
- `cli/` 是第一阶段唯一宿主，只负责验证壳和终端交互。
- `runtime` 过早拆分会增加进程通信、版本管理和调试成本。

## 技术栈

| 层级 | 技术选择 | 说明 |
| --- | --- | --- |
| 语言 | TypeScript | 适合 CLI、协议、Node 工具层和后续桌面端复用 |
| 运行时 | Node.js | 便于接入文件系统、Git、Shell、Pi SDK；Pi 包声明需要 `>=22.19.0` |
| 包管理 | pnpm workspace | 单仓库多包管理，保证 `protocol`、`core`、`cli` 边界清晰 |
| CLI 框架 | commander | 命令解析简单稳定 |
| 终端输出 | Ink v7 + React + picocolors + 自定义 renderer | M4.6 切换到 Ink v7，renderer 继续负责事件文本格式化 |
| 交互确认 | @inquirer/prompts | 用于写文件、执行命令、删除文件等确认 |
| diff 生成 | git diff 优先 | 以 Git 作为变更边界，避免自己实现 diff |
| 搜索 | ripgrep 调用 | 直接复用开发者环境中成熟工具 |
| trace | JSONL 文件 | 流式写入，便于复盘和调试 |
| 测试 | Vitest | TypeScript 项目启动成本低 |

## protocol/

### 职责

`protocol/` 只定义类型和协议，不实现业务逻辑。

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
- 转换 Pi 内部事件语义
- 编排任务生命周期
- 实现权限、trace、验证策略
- 读写文件
- 执行命令
- 展示 CLI
- 记录 trace 文件

### 目录结构

```text
protocol/
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
  | AssistantMessageDeltaEvent
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
export type AssistantMessageDeltaEvent = {
  type: "assistant.delta";
  taskId: string;
  channel: "text" | "thinking";
  text: string;
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

## core/

### 职责

`core/` 是第一阶段的核心能力层。

它负责：

- `AgentGateway` 和 `LocalAgentGateway`。
- `AgentOrchestrator`。
- `PiAdapter`、`PiRpcAdapter`、`PiRpcSessionAdapter`。
- `AgentConfig`、配置读取、配置校验和 session 创建。
- 系统提示词、skills、MCP server 描述、工具 allow/deny 和权限策略模型。
- `PiEventMapper`。
- 后续权限策略、trace、验证策略和工具边界。

它不负责：

- CLI 参数解析。
- 终端输入。
- 终端渲染。

### 目录结构

```text
core/
  package.json
  tsconfig.json
  src/
    index.ts
    config/
    gateway/
    orchestrator/
    session/
    pi/
  tests/
```

## cli/

### 职责

`cli/` 是第一阶段验证壳。

它负责：

- 提供默认 `agent` TUI 入口。
- 提供 `agent run "<任务描述>"`。
- 展示标准化事件流。
- 收集用户输入和运行时模型配置。
- 调用 `@coding-agent/core`。

它不应该直接调用 Pi。所有 Pi 相关能力必须经过 `@coding-agent/core` 中的 `AgentOrchestrator -> PiAdapter`。

CLI 也不应该承载系统提示词、skills、MCP、权限策略或工具策略。CLI 可以提供交互入口，但配置模型和执行策略必须落在 `core/`。

### 目录结构

```text
cli/
  package.json
  tsconfig.json
  src/
    cli.ts
    commands/
      tui.ts
      run.ts
      chat.ts
    ui/
      AgentTui.tsx
      EventStreamRenderer.ts
  tests/
    chat-command.test.ts
    run-config.test.ts
    tui-command.test.ts
    stream-renderer.test.ts
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
PiRpcAdapter
  -> 调用 Pi SDK RpcClient
  -> 启动 Pi RPC 子进程
  -> 把 Pi 输出转换成 PiAdapterEvent
```

后续：

```text
RuntimePiAdapter
  -> 调用本项目自己的 runtime 子进程
  -> 通过 JSON event stream 传输事件
```

### 模型配置

CLI 第一阶段在兼容命令 `agent run`、`agent chat` 中仍接收模型参数。M4 开始，默认 `agent` 入口进入 TUI，provider、model 和 API Key 可以在运行时输入。参数校验、供应商凭证映射和 `PiAdapterOptions` 组装由 `core/` 负责。这样后续桌面端可以复用同一套模型配置逻辑，而不是复制 CLI 实现。

```text
agent run "<任务描述>" \
  --provider deepseek \
  --model deepseek-chat \
  --workspace <本地项目路径>
```

支持两种凭证配置方式：

```text
DEEPSEEK_API_KEY=... agent run "<任务描述>" --provider deepseek --model deepseek-chat
```

```text
agent run "<任务描述>" --provider deepseek --model deepseek-chat --api-key "$DEEPSEEK_API_KEY"
```

当前凭证映射：

| provider | 环境变量 |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `google` / `gemini` | `GOOGLE_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |

配置校验规则：

- `agent`、`agent run` 和 `agent chat` 默认使用 Pi。
- 默认 workspace 是启动命令时的当前目录。
- 必须提供 `--provider`。
- 必须提供 `--model`。
- 必须能从运行时输入、`--api-key` 或对应环境变量拿到凭证。
- 如果 Pi 事件流返回 `task.failed`，CLI 必须返回非 0 退出码。
- `PiRpcAdapter` 必须通过 `onEvent + prompt + waitForIdle` 转发事件，避免使用批量收集后的 `promptAndWait`。
- `PiEventMapper` 必须把 Pi 的 `message_update` 转换成 `assistant.delta`，用于展示正文和 thinking 片段。
- `PiEventMapper` 必须从 `tool_execution_start.args` 中提取工具关键参数，例如读取路径和 bash 命令。

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

### agent

```bash
agent
```

行为：

1. 默认 workspace 从启动目录向上寻找 Git 根目录，找不到 Git 根时才使用当前目录。
2. 进入 Ink TUI。
3. 如果 provider、model 或 API Key 缺失，在 TUI 内提示运行时配置。
4. TUI 启动时确保生成 `<workspace>/.coding-agent/config.json`。
5. 用户通过 `Ctrl+M` 打开模型配置选择器，用方向键选择 provider 和 model，并可输入 API Key；配置保存后写回 workspace 配置文件。
6. 用户输入任务后，TUI 通过 `@coding-agent/core` 创建同一个 Pi RPC 会话。
7. 每轮实时展示 step、assistant delta、工具调用和最终模型输出。
8. 输入 `/` 会弹出命令候选菜单，可以选择 `/model`、`/workspace`、`/exit`。
9. 事件区按内容类型上色，并支持 `PageUp/PageDown` 滚动查看历史输出。
10. 事件区右侧显示文本滚动条，展示当前滚动位置。
11. 事件区和输入区避免使用边框，减少复制内容时带出框线。
12. `Ctrl+W` 显示当前工作区。
13. `Ctrl+C` 退出。

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

### agent chat

```bash
agent chat --provider deepseek --model deepseek-reasoner --workspace <本地项目路径>
```

行为：

1. 启动一个 Pi RPC 子进程。
2. 进入终端输入循环。
3. 每次用户输入都发送到同一个 Pi 会话。
4. 每轮实时渲染 step、assistant delta、工具调用和最终总结。
5. 输入 `/exit` 或 `/quit` 时停止会话并关闭 Pi RPC 子进程。

`agent chat` 是第一阶段验证多轮上下文的最小交互壳，不做复杂 TUI。

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

- `protocol/` 类型导出。
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

当前执行状态：

- M1：已完成
- M2：已完成
- M3：已完成配置能力，真实模型验证等待有效凭证
- M3.5：已完成工具详情、assistant delta 和 CLI 多轮交互
- M4：已完成，TUI 交互壳和 core 配置收敛
- M5：待规划，Trace 和 diff

### M1：协议模块

产物：

- `protocol/` 模块。
- 核心类型定义。
- 类型导出测试。

验收：

- `pnpm test` 通过。
- `core/` 和 `cli/` 可以依赖并导入协议类型。

### M2：CLI 骨架

产物：

- `cli/` 模块。
- `core/` 模块。
- `agent run` 命令。
- `LocalAgentGateway`。
- `AgentOrchestrator`。
- `FakePiAdapter`。
- 模拟事件流渲染。

验收：

- 运行 `agent run "测试任务"` 可以看到完整模拟流程。
- 不需要真实 Pi。

### M3：模型配置和 Pi RPC 接入

产物：

- `PiRpcAdapter`。
- `@earendil-works/pi-coding-agent` 依赖。
- `--provider`。
- `--model`。
- `--api-key`。
- 供应商环境变量映射。
- Pi CLI 路径解析。
- Pi 事件级流式转发。
- agent 失败事件的非 0 退出码。

验收：

- `pnpm test` 通过。
- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- 未配置 API Key 时，CLI 在配置层明确提示缺少哪个环境变量。
- 传入 `--api-key` 后，CLI 能进入 Pi RPC 启动路径。

当前状态：

- 配置能力已完成。
- 真实模型调用等待有效 API Key。
- 当前 Node.js 已升级到 `v24.18.0`，满足 Pi 包声明的 `>=22.19.0` 要求。

### M3.5：工具详情和多轮交互

产物：

- `AssistantMessageDeltaEvent` 协议类型。
- `PiEventMapper`。
- 工具调用参数摘要。
- `PiRpcSessionAdapter`。
- `agent chat` 命令。

验收：

- `message_update` 中的 assistant text 和 thinking 可以转换成 `assistant.delta`。
- `tool_execution_start` 可以展示 `read` 的文件路径和 `bash` 的命令。
- `agent chat` 可以在同一个 Pi RPC 会话中连续发送多轮输入。
- `pnpm test` 通过。
- `pnpm typecheck` 通过。
- `pnpm build` 通过。

当前状态：

- 已完成。
- thinking 是否出现取决于模型和 Pi RPC 事件是否实际返回 thinking content。
- CLI 仍保持轻量终端交互，不引入复杂 TUI。

### M4：TUI 交互壳和 core 配置收敛

产物：

- Ink TUI 默认入口。
- 运行时模型配置。
- `AgentConfig` 和 core 配置读取/解析。
- `AgentSessionFactory`，让 CLI 不直接创建 Pi session adapter。
- 简化 CLI 默认命令，workspace 默认解析到 Git 根目录。

验收：

- `agent` 不传参数即可进入 TUI。
- TUI 可以在运行时选择 provider、model 并输入 API Key。
- 输入 `/` 可以显示命令候选菜单。
- TUI 可以发送多轮任务到同一个 core session。
- `agent run` 和 `agent chat` 兼容命令继续可用。
- `pnpm test`、`pnpm typecheck`、`pnpm build` 通过。

### M5：Trace 和 diff

产物：

- `JsonlTraceStore`。
- `agent trace`。
- `agent diff`。
- Git diff 展示。

验收：

- 每次 `agent run` 都产生 trace 文件。
- `agent trace` 可以读取最近任务。
- `agent diff` 能展示当前工作区变更。

### M6：工具边界

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

### M7：真实模型任务验证

产物：

- 使用真实 API Key 的端到端验证记录。
- 至少一个只读本地项目验证。
- 至少一个小范围写入项目验证。

验收：

- `agent run "<真实任务>"` 能通过 Pi 读取仓库并返回总结。
- CLI 能展示 Pi 进度和失败状态。
- 后续 trace 和 diff 能记录关键过程。

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
| 真实模型调试成本高 | 配置层先做 provider/model/key 校验；无有效凭证时不进入真实模型调用 |
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

下一步不是直接做桌面端，而是在当前 workspace 内补齐核心能力。

推荐执行顺序：

1. 在 `core/` 增加运行时配置和 session facade。
2. 在 `cli/` 引入 Ink TUI 默认入口。
3. 保留 `agent run` 和 `agent chat` 兼容命令。
4. 在后续 M5 增加 trace/diff。
5. 在后续 M6 增加权限和工具边界。
6. 配置真实模型凭证，做端到端只读和小范围写入验证。
7. 评估是否从 `core/` 拆出独立 `coding-agent-runtime` 子进程。
