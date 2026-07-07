# 备忘录

这里记录已经确认过、但不需要一直占用 `project-state.md` 主线的信息。

## 已确认架构决策

- 当前仓库 `potato` 是单一 pnpm workspace。
- `protocol/` 是 `@potato/protocol`，只承载事件、任务、审批、diff、错误等类型契约。
- `core/` 是 `@potato/core`，承载 Agent 编排、配置、会话、Pi 适配、trace、diff、skill、MCP、SubAgent 和权限边界。
- `cli/` 是 `@potato/cli`，承载 commander 命令、Ink TUI、输入框、菜单和终端渲染。
- Pi 是当前底层 agent 执行引擎；当前真实路径是 `cli -> core -> Pi RPC -> Pi`。
- 当前 Pi RPC 路径可以透传 system prompt、append system prompt、skills、工具 allow/deny 和 Potato 自动生成的 Pi extensions。
- 手动审批通过 Potato Pi extension 实现：拦截 `bash/edit/write`，在执行前用 Pi extension UI confirm 展示确认和 diff preview。
- MCP 通过 Potato Pi extension bridge 注入为 Pi custom tools，当前只覆盖 stdio MCP。
- SubAgent 通过 Pi 官方 subagent extension 实现，Potato 负责把配置生成到 `.pi/agents/*.md`。
- Vercel AI SDK runtime 保留为内部实验 adapter，不再作为默认执行路径。

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

## 标准化和外部依赖替换备忘

当前项目里以下能力不应长期手写，适合优先采用成熟依赖或标准协议：

- Markdown 渲染：已从手写 renderer 切到 `marked` + `marked-terminal`，解决表格、代码块和常见 Markdown 的终端渲染问题。
- 表格渲染：已复用 `marked-terminal` 的表格能力。不要再手写 Markdown 表格解析。
- Diff 渲染：已改为基于 `parse-diff` 解析 unified diff，再输出终端友好的文本。后续如要语法高亮或 side-by-side，可继续叠加 `cli-highlight` 或 Ink 专用组件。
- Token 估算：已从 `chars / 4` 改为 `gpt-tokenizer`。后续多 provider 精准计数仍应接模型供应商 tokenizer。
- 上下文压缩：默认 Pi RPC session 优先调用 Pi 原生 `compact(customInstructions?)`。项目内 heuristic compaction 只作为 adapter 不支持 native compact 时的 fallback。
- 模型适配：CLI/core 默认走 Pi RPC。Vercel AI SDK + `@ai-sdk/openai-compatible` 保留为内部实验 adapter；桌面端前继续评估 LiteLLM、OpenRouter、OpenAI Agents SDK 等是否适合更高层编排。
- MCP 注入：默认 Pi RPC 通过 Potato 生成的 Pi MCP bridge extension 把 stdio MCP tools 注册成 Pi custom tools。内部实验 runtime 仍保留 `McpToolRegistry`，可把 MCP tools 映射进 AI SDK tools。
- 终端快捷键和输入：当前 Ink TUI 自行处理编辑、补全、快捷键和历史回填。若交互复杂度继续上升，需要评估专门的 readline/editor 抽象，避免在 `AgentTui.tsx` 里堆状态机。
- 联网搜索：DeepSeek API key 能调用模型不等于已具备联网搜索。开源优先方案是 SearXNG + MCP/search tool；托管方案可评估 Brave Search、Tavily、Exa、Firecrawl。Potato 必须通过明确的 web-search tool 或 MCP 注入暴露联网状态，不能把 provider 官网客户端能力等同于 API runtime 能力。
- Agent Loop / SubAgent：当前是项目内自定义抽象，不是行业标准协议。后续如要标准化，应评估 OpenAI Agents SDK/Responses tool loop、LangGraph、AutoGen/CrewAI 等可验证 runtime 模型；当前不能标记为标准实现。

当前已执行的标准化边界：

- TUI transcript 已取消应用内 PageUp/PageDown/上下键滚动截断，改为完整输出，滚动交给终端自身。
- Skills 现在同时通过 `--skill <path>` 传给 Pi，并写入 system prompt 的可见 skill context，包含 enabled/disabled/source/path，避免只靠隐式注入。
- Runtime capability report 已区分默认 Pi RPC 能力和内部实验 runtime 能力：Pi RPC 能力来自 Pi core + Potato extensions；runtime 对齐 Vercel AI SDK，MCP tools 对齐 Model Context Protocol SDK。

仍不能标记为完成的标准化：

- 已新增 `RuntimeSessionAdapter` / `RuntimeTaskAdapter`，但它们是内部实验路径，不是默认路径。
- MCP stdio server tools 已在 Pi RPC bridge 和实验 runtime `McpToolRegistry` 两条路径打通；当前尚未支持 streamable HTTP/SSE MCP transport。
- `runtime/sdk` 仍只应作为内部实验/测试路径，不应暴露为普通用户必须理解的运行模式。
- AgentLoop/SubAgent 仍是项目内抽象；要变成标准 runtime 需要引入可执行的 graph/agent runtime，而不是只改类型名。

## 依赖审计备忘

当前依赖审计结论：

- 没有发现可安全删除的生产依赖。
- `cli/package.json` 不直接声明 `@earendil-works/pi-coding-agent`。发布脚本 external 掉 Pi，并从 `core/package.json` 读取 Pi 版本写进 `.release/npm/cli/package.json` 的 dependencies；发布包运行时仍必须能解析 Pi。
- `core` 里的 `ai` 和 `@ai-sdk/openai-compatible` 只服务内部实验 runtime；如果后续决定彻底放弃实验 runtime，才能连同 `RuntimeSessionAdapter`、`RuntimeTaskAdapter`、`McpToolRegistry` 的 AI SDK 映射一起删除。
- `@modelcontextprotocol/sdk` 同时服务实验 `McpToolRegistry` 和生成的 Pi MCP bridge extension；当前不能删除。
- `gpt-tokenizer` 当前用于 context budget 估算；后续如果完全改用 Pi session stats 或 provider tokenizer，可再评估替换。

## 当前上下文压缩机制

当前实现位置：

- `core/src/context/ContextBudget.ts`
- `core/src/loop/AgentLoop.ts`
- `core/src/session/AgentSession.ts`

判断逻辑：

- `HeuristicContextBudgetManager` 默认 `maxTokens = 120000`。
- 默认 `compactAtRatio = 0.75`。
- `estimateTokens(text)` 当前使用 `gpt-tokenizer`。
- `ratio = usedTokens / maxTokens`。
- 当 `ratio >= compactAtRatio` 时触发 `context.compacted`。

当前压缩算法：

- 现在不是模型摘要，也不是历史消息真实裁剪。
- 当前 `compact()` 生成一个固定结构的 heuristic summary，包含 task、workspace、state 和 next。
- `/compact` 在默认 Pi RPC session 下优先调用 Pi 原生 compact；非 Pi/native compact 不可用时才触发 heuristic compaction 事件。
- token 使用量会在 session 内累计 prompt 和 final output，因此下一轮会看到 `used/max tokens` 增长；百分比在大窗口下可能仍显示 `<1%`。
- 这个阶段主要用于打通 AgentLoop、AgentSession、trace、TUI 展示和验证路径。

后续需要补齐：

- 用真实模型对历史上下文做 summary。
- 保留目标、关键文件、已确认决策、未完成事项、风险和下一步。
- 把旧消息窗口替换为 summary，而不是只发事件。
- 针对不同模型/provider 切换对应 tokenizer。

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
  - 是否保留当前内部实验 Vercel AI SDK runtime。
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

- Pi RPC 路径的手动审批由 Potato extension 实现，但仍要继续提升 diff preview 和拒绝后的暂停体验。
- MCP 已有 stdio bridge 注入，仍需补 streamable HTTP/SSE transport、错误展示和工具列表可视化。
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
