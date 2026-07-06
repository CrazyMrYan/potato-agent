# 备忘录

这里记录已经确认过、但不需要一直占用 `project-state.md` 主线的信息。

## 已确认架构决策

- 当前仓库 `potato` 是单一 pnpm workspace。
- `protocol/` 是 `@potato/protocol`，只承载事件、任务、审批、diff、错误等类型契约。
- `core/` 是 `@potato/core`，承载 Agent 编排、配置、会话、Pi 适配、trace、diff、skill、MCP、SubAgent 和权限边界。
- `cli/` 是 `@potato/cli`，承载 commander 命令、Ink TUI、输入框、菜单和终端渲染。
- Pi 是当前底层 agent 执行引擎；当前真实路径是 `cli -> core -> Pi RPC -> Pi`。
- 当前 Pi RPC 路径可以透传 system prompt、append system prompt、skills 和工具 allow/deny，但不能声明 core 已完全接管工具执行边界。
- 真正由本项目接管 MCP 注入和工具二次确认，需要后续 Pi SDK session 或本项目 runtime adapter。

## 工作区布局

```text
/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/
  wiki/      # 知识库和阶段记录
  protocol/  # @potato/protocol
  core/      # @potato/core
  cli/       # @potato/cli
```

旧的 sibling 仓库 `coding-agent-cli/` 和 `coding-agent-protocol/` 是早期验证遗留目录，当前目标结构以本仓库子目录为准。

## CLI 发布形态

当前只计划发布 CLI 包：

```text
@potato/cli
```

发布目标：

- 支持 `npx @potato/cli`。
- 支持 `npm install -g @potato/cli` 后运行 `potato`。
- npm 包内不发布源码树，发布 `.release/npm/cli/dist/cli.js` 压缩 bundle。
- `@earendil-works/pi-coding-agent` 保持为运行时依赖，不打进 bundle，避免破坏 Pi 运行时的动态加载逻辑。

发布脚本：

```bash
pnpm build:npm:cli
```

发布文档：

- [NPM Release](../docs/npm-release.md)

## CLI 命令原则

- 终端打开命令保持简单，不做过多复杂参数。
- 默认 `potato` 进入 TUI。
- 保留 `--help`、`--version`、workspace、provider、model、api-key、timeout、权限模式等必要参数。
- 高级配置优先放到 TUI 菜单、workspace 配置或后续桌面端设置里。
- 不在 CLI 参数里堆太多长期产品配置，避免命令入口失控。

## 桌面端前置待办

桌面端阶段开始前需要重新评估：

- 模型适配层：
  - OpenAI-compatible provider config。
  - LiteLLM 作为网关。
  - Vercel AI SDK 作为 TypeScript runtime 抽象。
  - OpenRouter 作为多模型托管入口。
- Runtime 形态：
  - 是否继续 Pi RPC。
  - 是否切 Pi SDK session。
  - 是否拆 `potato-runtime` 子进程。
- UI 能力：
  - 可视化 diff。
  - 事件时间线。
  - 文件树。
  - SubAgent 状态面板。
  - Skill/MCP 管理面板。

## Wiki 维护规则

`wiki/` 是项目知识库，也是阶段信息的事实来源。

以后每次发生以下变化，都必须同步维护 `wiki/`：

- 架构层级变化。
- 技术方案变化。
- 仓库拆分变化。
- 阶段目标变化。
- 里程碑状态变化。
- 模块职责变化。
- 权限策略变化。
- trace、diff、工具边界等核心协议变化。
- CLI 发布和部署方式变化。
- 执行验证结果变化。

如果代码实现和 wiki 不一致，优先更新 wiki，并在同一提交中说明原因。

## 提交约定

阶段信息变化应独立提交，避免和大量实现代码混在一起。

推荐提交信息：

```text
docs: update project stage
docs: update technical plan
docs: record validation result
```

## 历史阶段摘要

### M5：核心能力补齐

状态：进行中。

已落地方向：

- Trace 默认自动开启，记录任务输入、事件、diff 和最终状态。
- Diff 成为用户查看工作区变化的核心入口。
- `AgentLoop` 统一任务生命周期、trace、diff 和 runtime capability 记录。
- `SkillManager` 支持内置 skill、本地 skill、Git skill、启用/禁用。
- `McpConfigChecker` 支持 MCP command/env/startup/adaptor capability 检测。
- TUI 增加 `/mode`、`/skill`、`/mcp`、`/agent`。
- TUI 输入框支持 slash command、`@file` 和 `$skill` 候选。
- Manual 权限开始支持写入前 diff 预览和拒绝暂停。
- CLI npm 发布链路开始建立。

仍需继续：

- Pi RPC 路径不能虚标 core 已接管最终工具权限。
- MCP 仍需从配置检测走向真实注入。
- diff、trace、approval 的展示质量需要继续提升。

### M4.6：Ink v7 TUI 迁移

状态：已完成。

结果：

- 从 `@vue-tui/runtime` 迁移到 Ink v7。
- 默认 `potato` 入口进入 TUI。
- 根目录 `pnpm dev` 转发到 CLI dev 入口。
- 保留 PageUp/PageDown 翻页。
- 事件展示改为结构化 `{ kind, text }`。

### M4.5：运行配置模型收敛

状态：已完成。

结果：

- `AgentConfig` 支持 system prompt、append system prompt、skills、MCP、tools 和 permission policy。
- `buildPiRpcArgs` 能把当前 Pi CLI 支持的参数传给 RPC。
- CLI/TUI 不再承载系统提示词、skills、MCP 和工具权限的核心模型。
- 模型最终输出按原文展示，不强行增加固定前缀。

### M4：TUI 交互壳和 core 配置收敛

状态：已完成。

结果：

- 默认 `potato` 进入交互式 TUI。
- 模型配置、workspace 配置和 session 创建能力下沉到 core。
- TUI 启动时确保生成 `<workspace>/.potato/config.json`。
- `chat` 兼容命令改为通过 `AgentSessionFactory` 创建会话。

### M3.7：模型配置能力下沉到 core

状态：已完成。

结果：

- `core/src/pi/resolvePiAdapterOptions.ts` 负责 provider、model、API key 和供应商环境变量映射。
- `cli/` 不再保留独立模型配置解析文件。

### M3.6：单仓库 workspace 迁移和 core 拆分

状态：已完成。

结果：

- `protocol/`、`core/`、`cli/` 迁入当前单仓库 workspace。
- `core/` 承载 AgentGateway、AgentOrchestrator、PiAdapter、PiRpcAdapter、PiRpcSessionAdapter 和 PiEventMapper。
- `cli/` 保持命令入口、终端输入、终端渲染和 CLI 测试。

### M3.5：工具详情、推理片段和多轮交互

状态：已完成。

结果：

- `assistant.delta` 支持 `text` 和 `thinking`。
- `PiEventMapper` 转换 Pi RPC 原始事件。
- 工具事件提取关键参数，例如读取文件路径和 bash 命令。
- `potato chat` 使用同一个 Pi RPC 子进程持续多轮对话。

### M1-M2：协议和 CLI 骨架历史记录

状态：已完成。

说明：

M1-M2 最初在 sibling 仓库中验证，M3.6 已迁入当前单仓库 workspace。历史 sibling 仓库只作为记录，不再代表当前目标结构。
