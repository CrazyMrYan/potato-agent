# 架构设计

## 当前方向

构建一个面向开发者的编码智能体产品。第一阶段不优先做桌面 UI，而是先通过 CLI 验证核心工作流。

产品需要先证明自己能完成这些事情：

- 接收开发者任务。
- 使用 Pi 作为底层智能体执行引擎。
- 检查并理解本地代码仓库。
- 在智能体工作时展示当前进展。
- 应用或提出代码变更。
- 清晰展示文件差异。
- 必要时运行验证命令。
- 汇报变更内容和仍不确定的事项。

## 核心决策

直接使用 Pi RPC 作为默认底层智能体执行引擎，但不把产品能力全部塞进 Pi。

本项目自己的核心能力放在智能体编排层。它位于 CLI 和 Pi 之间，负责任务生命周期、权限、上下文策略、验证策略、diff 策略、MCP bridge、SubAgent 配置和运行记录。

默认运行路径：

```text
@potato/cli -> @potato/core -> Pi RPC -> Pi core tools/session/compaction
                         \-> Potato-generated Pi extensions
```

Potato 通过自动生成的 Pi extensions 注入产品层能力：

- `potato-approval.ts`：手动模式下拦截 `bash/edit/write`，执行前展示确认和 diff preview。
- `potato-mcp-bridge.ts`：把 stdio MCP server tools 注册成 Pi custom tools。
- Pi 官方 `subagent` extension：Potato 把 `SubAgentConfig` 物化为 `.pi/agents/*.md`，由独立 Pi 子进程执行。

第一阶段宿主 UI 使用 CLI。CLI 不需要精致界面，只需要让智能体循环可观察：

- 当前步骤
- 正在执行的工具或动作
- 关键命令输出
- 涉及的文件
- 差异预览
- 最终总结

## 工程约定

项目文档和用户可见文本默认使用中文。后续如果需要英文，可以作为可配置的国际化能力加入。

## 总体架构

```text
CLI
  面向用户的第一阶段验证壳。
  负责启动任务、展示进度、展示 diff、请求确认。

智能体编排层
  本项目自己的产品能力层。
  负责任务生命周期、上下文策略、权限策略、验证策略、diff 策略和 trace。

Pi 执行引擎
  底层智能体执行引擎。
  负责推理、规划、工具调用和 agent loop。

工具运行层
  暴露给智能体的本地能力。
  包括文件读写、搜索、补丁、Shell、Git diff 和测试命令。

知识库
  存放在 wiki 目录中。
  记录决策、实验、架构笔记和实现计划。
```

```mermaid
flowchart TB
    User["开发者"] --> CLI["CLI 验证壳<br/>任务输入 / 进度展示 / diff 展示"]
    CLI --> Orchestrator["智能体编排层<br/>任务 / 权限 / 上下文 / 验证 / trace"]
    Orchestrator --> Pi["Pi RPC 执行引擎<br/>推理 / session / tools / compaction"]
    Orchestrator --> Ext["Potato Pi Extensions<br/>approval / MCP bridge / subagent"]
    Ext --> Pi
    Pi --> Tools["工具运行层"]
    Tools --> FS["文件系统<br/>读取 / 写入 / Patch"]
    Tools --> Search["代码搜索<br/>文件匹配 / 内容检索"]
    Tools --> Shell["Shell<br/>命令执行 / 测试 / 构建"]
    Tools --> Git["Git<br/>状态 / diff / 提交边界"]
    Orchestrator --> Trace["运行记录<br/>步骤 / 工具调用 / 结果 / 错误"]
    CLI --> Wiki["知识库<br/>架构 / 决策 / 实验记录"]
```

## 包级架构

当前代码采用 pnpm workspace，分为三个可独立理解的包：

```text
protocol/  @potato/protocol
  稳定协议层，只放类型契约。

core/      @potato/core
  Agent 产品能力层，包含配置、会话、编排、Pi 适配、trace、diff、skill、MCP、SubAgent 和权限边界。

cli/       @potato/cli
  用户入口层，包含 commander 命令、Ink TUI、输入框、菜单和终端事件渲染。
```

依赖方向必须保持单向：

```mermaid
flowchart LR
    CLI["@potato/cli<br/>命令 / TUI / 输入 / 展示"] --> Core["@potato/core<br/>会话 / 编排 / Pi 适配 / 能力管理"]
    CLI --> Protocol["@potato/protocol<br/>事件 / 任务 / 审批 / diff 类型"]
    Core --> Protocol
    Core --> Pi["@earendil-works/pi-coding-agent<br/>Pi RPC / 底层 potato 执行"]
    Core --> McpSdk["@modelcontextprotocol/sdk<br/>stdio MCP bridge"]
    Core --> AiSdk["Vercel AI SDK<br/>内部实验 runtime"]

    Protocol -. "不依赖业务实现" .-> None1["无下游依赖"]
```

约束：

- `protocol` 不能依赖 `core` 或 `cli`。
- `core` 不能依赖 `cli`。
- `cli` 可以依赖 `core` 和 `protocol`，但不直接接管 Pi 细节。
- Pi 相关实现收敛在 `core/src/pi/`，CLI 只通过 `AgentSessionFactory`、`AgentSession` 或命令 API 使用。
- 默认 adapter 是 Pi RPC。`runtime/sdk` 只作为内部实验路径保留，不能要求普通用户理解或选择。

## protocol 独立架构

`protocol` 是跨层契约包，目标是稳定、轻量、无副作用。它定义“系统里发生什么”，不定义“怎么执行”。

```mermaid
flowchart TB
    Protocol["@potato/protocol"]
    Protocol --> Task["task.ts<br/>RunTaskInput / TaskMode / ApprovalMode"]
    Protocol --> Events["events.ts<br/>AgentEvent union<br/>task / step / tool / approval / subagent / diff / verification"]
    Protocol --> Approval["approval.ts<br/>ApprovalRequest / ApprovalDecision"]
    Protocol --> Changeset["changeset.ts<br/>ChangeSet / FileChangeStatus"]
    Protocol --> Errors["errors.ts<br/>AgentError / AgentErrorCode"]
    Protocol --> Index["index.ts<br/>统一导出"]
```

边界：

- 只包含 TypeScript 类型和稳定事件结构。
- 不读取文件、不启动进程、不访问 Git、不包含 UI。
- `core` 和 `cli` 都可以使用这些类型，保证事件流和命令输出有共同语言。

## core 独立架构

`core` 是本项目的 Agent 产品能力层。它把 Pi 的底层执行能力包装成可观测、可配置、可扩展的 Coding Agent 会话。

```mermaid
flowchart TB
    Core["@potato/core"]

    Config["config/<br/>AgentConfig / ConfigStore / Workspace"] --> SessionFactory["session/AgentSessionFactory"]
    Skills["skills/SkillManager"] --> SessionFactory
    SubAgents["subagent/<br/>SubAgentManager / SubAgentConfig"] --> SessionFactory

    SessionFactory --> Session["session/AgentSession<br/>start / send / approve / pause / compact"]
    Session --> PiAdapter["pi/PiSessionAdapter"]
    PiAdapter --> PiMapper["pi/PiEventMapper"]
    PiMapper --> ProtocolEvents["@potato/protocol events"]
    PiAdapter --> PiRuntime["pi/PotatoPiRuntime<br/>生成 approval / MCP / subagent extensions"]

    Gateway["gateway/<br/>AgentGateway / LocalAgentGateway"] --> Orchestrator["orchestrator/AgentOrchestrator"]
    Orchestrator --> Loop["loop/AgentLoop<br/>lifecycle / trace / diff / final events"]
    Loop --> Trace["trace/JsonlTraceStore"]
    Loop --> Diff["diff/GitDiffService"]

    Tools["tools/ToolBoundary"] --> Config
    MCP["mcp/<br/>McpConfigChecker / McpToolRegistry"] --> Config
    Runtime["runtime/<br/>RuntimeCapabilityReporter / experimental adapters"] --> Orchestrator
```

主要职责：

- `config/`：模型、workspace、工具权限、skills、MCP、SubAgent 等运行配置。
- `session/`：长期会话抽象，负责 start/send/stop/approval/pause。
- `pi/`：Pi RPC 适配、原始事件映射、Pi CLI 路径解析、Pi 子进程 env 处理、Potato Pi extension 生成。
- `loop/` 和 `orchestrator/`：统一任务生命周期，围绕 adapter 事件补齐 trace、diff、最终状态。
- `trace/`：JSONL 任务审计记录。
- `diff/`：Git 工作区变更检测和 patch 读取。
- `skills/`：内置和外部 skill 的发现、安装、启用/禁用。
- `subagent/`：单 SubAgent 选择和配置合并。
- `mcp/`：MCP 配置检测；默认 Pi RPC 路径通过生成的 Pi extension bridge 注入 stdio MCP tools，实验 runtime 通过 `McpToolRegistry` 映射到 AI SDK tools。
- `tools/`：工具权限边界抽象。
- `runtime/`：内部实验 adapter，基于 Vercel AI SDK / OpenAI-compatible provider。当前不是默认执行路径。

## 默认执行路径

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as @potato/cli
    participant Core as @potato/core
    participant Pi as Pi RPC
    participant Ext as Potato Pi Extensions
    participant Tools as Pi Tools / MCP / SubAgent

    U->>CLI: 输入任务
    CLI->>Core: AgentSessionFactory.create(config)
    Core->>Core: SkillManager / SubAgentManager 合并配置
    Core->>Core: PotatoPiRuntime 生成 extensions 和 .pi/agents
    Core->>Pi: 启动 RpcClient(--system-prompt, --skill, --tools, --extension)
    Pi->>Ext: 加载 approval / MCP bridge / subagent extensions
    CLI->>Pi: prompt(message)
    Pi->>Tools: read / grep / bash / edit / write / MCP tool / subagent
    Tools-->>Pi: tool result
    Pi-->>Core: RPC events
    Core-->>CLI: AgentEvent
    CLI-->>U: transcript / approval / diff / final
```

## 依赖边界

当前生产依赖按职责划分：

| 包 | 关键依赖 | 用途 |
|---|---|---|
| `protocol` | 无运行时依赖 | 类型契约 |
| `core` | `@earendil-works/pi-coding-agent` | 默认执行底座、RPC client、Pi extension 路径 |
| `core` | `@modelcontextprotocol/sdk` | stdio MCP 检测和 bridge |
| `core` | `ai`、`@ai-sdk/openai-compatible` | 内部实验 runtime 和 MCP tool 映射 |
| `core` | `gpt-tokenizer` | context budget token 估算 |
| `cli` | `commander`、`ink`、`react` | CLI 和 TUI |
| `cli` | `marked`、`marked-terminal` | Markdown 终端渲染 |
| `cli` | `parse-diff` | unified diff 解析 |
| `cli` | `picocolors` | 命令输出颜色 |
| release package | `@earendil-works/pi-coding-agent` | 从 `core/package.json` 继承到 `.release/npm/cli/package.json`，因 bundle external Pi |

最近依赖扫描没有发现可安全删除的生产依赖。`core` 里的 AI SDK 相关依赖只服务内部实验 runtime；如果后续决定彻底放弃该路径，才可以连同相关源码和测试一起删除。

## cli 独立架构

`cli` 是用户交互层。它不拥有 Agent 决策逻辑，只负责把用户输入转成 core 调用，并把 core/protocol 事件展示出来。

```mermaid
flowchart TB
    CLI["@potato/cli"]

    Entry["cli.ts<br/>commander 入口"] --> Commands["commands/"]
    Commands --> Run["run.ts<br/>一次性任务"]
    Commands --> Chat["chat.ts<br/>多轮命令行会话"]
    Commands --> DiffCmd["diff.ts<br/>显示 Git diff"]
    Commands --> TraceCmd["trace.ts<br/>读取 trace"]
    Commands --> TuiCmd["tui.tsx<br/>启动 Ink TUI"]

    TuiCmd --> AgentTui["ui/AgentTui.tsx<br/>TUI 状态机 / slash menu / approval / skill / mcp / subagent"]
    AgentTui --> PromptEditor["ui/PromptEditor.ts<br/>光标 / 补全 / @file / $skill token"]
    AgentTui --> Renderer["ui/EventStreamRenderer.ts<br/>AgentEvent -> 终端行"]

    Commands --> Core["@potato/core"]
    AgentTui --> Core
    Renderer --> Protocol["@potato/protocol"]
```

主要职责：

- `cli.ts`：定义 `potato`、`potato run`、`potato chat`、`potato diff`、`potato trace`。
- `commands/`：命令模式的薄封装，负责参数解析后的业务调用。
- `ui/AgentTui.tsx`：交互式 TUI 状态机，处理 `/mode`、`/skill`、`/mcp`、`/agent`、审批、暂停、diff 展示。
- `ui/PromptEditor.ts`：输入框编辑模型，支持光标、补全检测、`@file`、`$skill`。
- `ui/EventStreamRenderer.ts`：把 protocol 事件转成终端可读文本。

CLI 不应该直接：

- 解析 Pi 原始事件。
- 决定 potato 编排策略。
- 直接读取或修改 core 的持久化结构。
- 绕过 core 去实现权限、trace、diff、skills 或 SubAgent 逻辑。

## 任务执行流程

```mermaid
flowchart TD
    A["用户输入任务"] --> B["CLI 创建任务上下文"]
    B --> C["智能体编排层建立任务策略"]
    C --> D["Pi 分析任务并收集上下文"]
    D --> E{"是否需要更多信息？"}
    E -- "是" --> F["调用工具读取文件 / 搜索代码 / 查看 Git 状态"]
    F --> D
    E -- "否" --> G["生成计划或下一步动作"]
    G --> H{"动作是否需要确认？"}
    H -- "是" --> I["CLI 请求用户确认"]
    I --> J{"用户是否同意？"}
    J -- "否" --> K["调整计划或停止任务"]
    J -- "是" --> L["执行工具动作"]
    H -- "否" --> L
    L --> M["产生文件变更或命令结果"]
    M --> N["CLI 展示进度和 diff"]
    N --> O{"是否需要验证？"}
    O -- "是" --> P["运行测试 / 构建 / 检查命令"]
    P --> Q{"验证是否通过？"}
    Q -- "否" --> C
    Q -- "是" --> R["输出最终总结"]
    O -- "否" --> R
```

## 近期验证目标

第一个实用里程碑是 CLI 能够针对一个本地仓库运行任务，并展示：

```text
收到任务
收集上下文
计划或下一步动作
工具 / 动作进度
文件差异
验证结果
最终总结
```

CLI 只是验证壳。长期产品可以再加入桌面端宿主，但不替换核心模型。
