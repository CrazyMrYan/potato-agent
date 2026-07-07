# 项目阶段状态

## 当前状态

项目当前处于第一阶段 CLI 验证期，核心方向是先把 `potato` 的 Agent 产品闭环跑通，再进入桌面端。

当前已经具备：

- CLI 默认 TUI、`run`、`chat`、`diff`、`trace`。
- TUI slash command：`/mode`、`/skill`、`/mcp`、`/agent`、`/diff`、`/trace`。
- Core 基础能力：`AgentLoop`、`AgentSession`、`SkillManager`、`McpConfigChecker`、`SubAgentManager`、trace、diff、权限策略。
- 当前默认执行底座已经切回 Pi RPC。Potato 在 Pi 之上自动注入产品层 extensions：manual approval、MCP bridge、SubAgent。
- M6 第一批体验能力：context budget/自动压缩事件、Markdown 正文渲染、统一 diff renderer、thinking/tool/diff 展开收起、network capability 展示。
- Manual 权限模式已开始支持写入前确认、拒绝暂停和 diff 预览，但展示质量还需要继续提升。
- CLI npm 发布链路已建立，目标包是 `@potato/cli`，启动命令是 `potato`。

已经确认但偏备忘性质的内容移到：

- [备忘录](memo.md)

## 当前边界

- Pi 是当前底层 agent 执行引擎，真实路径是 `cli -> core -> Pi RPC -> Pi`。
- 当前 Pi RPC 路径可以透传 system prompt、append system prompt、skills、工具 allow/deny 和 Potato runtime extensions。
- Manual approval 由 Potato 生成的 Pi extension 拦截 `bash/edit/write`，通过 Pi extension UI confirm 实现。它不是 Pi 原生权限弹窗，但是真实执行前 hook。
- MCP 由 Potato 生成的 `potato-mcp-bridge` Pi extension 注入为 Pi custom tools，工具名为 `<server>__<tool>`。当前只覆盖 stdio MCP。
- SubAgent 复用 Pi 官方 subagent extension，Potato 把 `SubAgentConfig` 物化为 `.pi/agents/*.md`，由独立 Pi 子进程执行。
- Vercel AI SDK runtime 仍保留为内部实验路径，不是默认执行路径。
- 桌面端启动前再评估 LiteLLM、OpenRouter、OpenAI Agents SDK、Vercel AI SDK 等更高层模型/agent 适配层。

## M6 目标：Core 体验闭环

M6 的目标不是继续堆功能入口，而是让 core 的关键能力在 CLI/TUI 中真实可见、可验证、可发布。

### 1. 自动上下文压缩

目标：

- core 增加上下文预算模型，跟踪当前任务上下文占用。
- 当上下文接近阈值时自动压缩。
- 压缩结果必须保留任务目标、关键文件、已做决策、未完成事项、风险和下一步。
- trace 记录压缩前后状态，便于复盘。

当前状态：

- 已新增 `ContextBudgetManager` 和 `HeuristicContextBudgetManager`。
- `AgentLoop`、`AgentSession` 会发出 `context.budget`，超过阈值时发出 `context.compacted`。
- trace 已记录 `context.budget` 和 `context.compacted`。
- 默认 Pi RPC 会话的 `/compact` 优先调用 Pi RPC 原生 `compact(customInstructions?)`。
- 当 adapter 不支持 native compact 时，才 fallback 到 heuristic 摘要入口。
- 后续需要把 UI 上的 context budget 和 Pi 真实 session stats 更精确地对齐。

建议模块：

```text
core/src/context/ContextBudget.ts
core/src/context/ContextCompactor.ts
core/src/context/ContextSummary.ts
```

CLI/TUI 展示：

```text
context ◉◉◉◉○○○○○○ 42% · compact at 75%
```

状态规则：

- 低占用：普通色。
- 接近压缩阈值：黄色。
- 已接近上限或压缩失败：红色。
- 压缩完成后展示最近一次压缩时间和摘要大小。

### 2. Markdown 渲染

目标：

- assistant 正文支持 Markdown 终端渲染。
- 支持标题、列表、引用、代码块、inline code、表格的基础展示。
- 代码块保持可复制，不加复杂边框。
- thinking、tool、diff、trace 不走普通 Markdown 渲染，避免误渲染。

当前状态：

- `EventStreamRenderer` 已对 assistant text 做轻量 Markdown 渲染。
- 当前支持标题、列表、引用、代码围栏和 inline code 的基础终端化。
- 未引入完整 Markdown AST，复杂表格仍待后续增强。

CLI/TUI 要求：

- 输出内容比现在更清晰。
- 不增加“步骤：”“工具：”这类硬编码前缀。
- 模型原始内容应尽量保真，只做终端友好的排版和颜色。

### 3. Diff 展示优化

现状：

- 当前 diff 能显示 patch，但样式偏粗糙。
- 审批里的 diff 预览已经有基础红绿行，但整体阅读体验不够好。

M6 目标：

- `/diff` 和审批 diff 使用统一的 diff renderer。
- 文件级分组展示。
- `+` 行绿色，`-` 行红色，`@@` hunk 灰色，文件 header 弱化。
- 大 diff 自动折叠，只展示关键片段和“展开更多”提示。
- 手动模式写入前展示“将修改哪些文件、具体改动是什么”，用户再决定允许或暂停。

当前状态：

- 已新增统一 `DiffRenderer`。
- `/diff`、run 结束 diff event 和 TUI `/diff` 使用同一套文本 renderer。
- 审批 extension 里的 diff 预览仍是独立轻量实现，后续需要接入同一 renderer。

建议模块：

```text
cli/src/ui/DiffRenderer.ts
core/src/diff/ChangeSetFormatter.ts
```

### 4. 思考和工具调用的展开/收起

目标：

- 默认 transcript 更干净，只展示用户输入、assistant 正文、关键工具摘要和最终结果。
- thinking 和 tool detail 可以展开/收起。
- TUI 里支持当前任务事件分组，例如：

```text
Assistant
Tools (3) collapsed
Thinking collapsed
Diff (2 files)
```

M6 最小实现：

- TUI 状态里保留事件分组。
- 默认折叠 thinking。
- 工具调用默认显示一行摘要。
- 提供按键切换展开状态。

当前状态：

- TUI 已默认折叠 thinking。
- 支持 `Ctrl+T` 展开/收起 thinking，`Ctrl+O` 展开/收起 tool output，`Ctrl+D` 展开/收起 diff detail。
- 为避免影响正常输入，不使用裸 `t/o/d` 快捷键。

建议先支持：

- `t` 展开/收起 thinking。
- `o` 展开/收起 tool output。
- `d` 展开/收起 diff detail。

### 5. 联网能力边界

需要先确认当前 Pi/模型路径是否已经自带联网工具。

判断原则：

- 如果 Pi RPC 或模型自身已经能通过工具调用联网，M6 不重复实现浏览器/搜索工具，只需要在 capability report 和 UI 中显示“当前 adapter 支持/不支持联网”。
- 如果当前路径没有联网工具，M6 只做能力检测和配置入口，不急于自建 web search。
- 真正的联网工具应该走 MCP 或 runtime tool boundary，不能绕过 core 权限策略。

M6 目标：

- `RuntimeCapabilityReporter` 增加 network/web capability。
- `/mcp check` 或 `/agent` 状态区能显示当前 adapter 是否支持联网。
- 不虚标“已支持联网”。如果只是模型供应商可能内部联网，必须写成“未知/由模型供应商决定”。

当前状态：

- `RuntimeCapabilityReporter` 已增加 `network` 字段。
- TUI 状态栏显示 `network unknown`。
- Pi RPC 路径仍不声明本项目已提供联网工具。

### 6. CLI 发布和部署

M6 必须把 CLI 发布作为正式验收项。

目标：

- `pnpm build:npm:cli` 稳定生成发布目录。
- `.release/npm/cli` 可 `npm pack`。
- 本地 tarball 安装后 `potato --help` 正常。
- 发布后 `npx @potato/cli --help` 正常。
- 发布包只包含压缩 bundle、`package.json` 和 README。

验收命令：

```bash
pnpm build:npm:cli
cd .release/npm/cli
npm pack --dry-run
npm pack
npm install -g ./potato-cli-0.1.0.tgz
potato --help
```

发布后验证：

```bash
npx @potato/cli --help
npx @potato/cli
```

### 7. 权限和审批继续收敛

M6 保持以下原则：

- `manual` 是默认模式。
- 手动模式允许修改，但必须先展示具体变化并由用户确认。
- 用户按 `n`、`Esc` 或暂停键时，当前任务应暂停，不应继续让模型绕路执行。
- `auto` 可以自动执行，但任务结束必须展示 diff。
- `readonly` 禁止写入和变更类 shell。

CLI/TUI 必须明确展示当前权限模式。

## 依赖审计快照

最近一次依赖引用扫描结论：

- `core` 的生产依赖均有当前源码引用：
  - `@earendil-works/pi-coding-agent`：Pi RPC、Pi CLI 路径解析、Pi subagent extension 路径解析。
  - `@modelcontextprotocol/sdk`：`McpToolRegistry` 和生成的 Pi MCP bridge extension。
  - `ai`、`@ai-sdk/openai-compatible`：内部实验 `RuntimeSessionAdapter` / `RuntimeTaskAdapter` 和 MCP tool 映射。
  - `gpt-tokenizer`：context budget token 估算。
  - `@potato/protocol`：跨层事件、任务、审批、diff 类型。
- `cli` 的生产依赖均有当前源码引用，或属于发布期必要运行依赖：
  - `@inquirer/prompts`：`chat` 兼容命令。
  - `commander`、`ink`、`react`：CLI/TUI。
  - `marked`、`marked-terminal`：Markdown 终端渲染。
  - `parse-diff`：统一 diff renderer。
  - `picocolors`：事件输出颜色。
- `cli/package.json` 不直接声明 `@earendil-works/pi-coding-agent`。npm 发布脚本从 `core/package.json` 读取 Pi 版本，并写入 `.release/npm/cli/package.json`，因为 bundle external 掉 Pi，发布包运行时必须能解析 Pi 包。
- 暂未发现可以安全删除的 package 依赖。
- 已清理不再返回的 `McpCheckStatus` 死状态：`adapter-unsupported`。

## M6 非目标

M6 不做以下事情：

- 不启动桌面端开发。
- 不把 LiteLLM、OpenRouter、OpenAI Agents SDK 绑定为默认 core runtime。
- 不把 Vercel AI SDK runtime 作为默认路径；它只保留为内部实验 adapter。
- 不承诺 MCP 已覆盖所有 transport；当前只覆盖 stdio MCP bridge。
- 不承诺 core 已完全接管 Pi RPC 的最终工具执行权限。
- 不把 CLI 做成复杂参数平台。
- 不实现完整图形 diff，只做终端可读 diff。

## M7 计划想法

M7 先记录几个下一阶段的主要想法，不在这里展开成详细设计：

- 知识库：维护知识库作为项目事实来源，让架构、边界、阶段状态和关键决策更稳定地沉淀下来。
- 工作区全局记忆：希望 agent 在同一 workspace 下能逐步复用长期信息，减少每次任务都从头解释项目背景。也可与设置全局。
- 中止操作：希望除了暂停之外，再补一个更明确的任务中止能力，让用户能直接结束当前任务。

这一阶段先放方向，不提前把实现结构、交互细节和底层机制写死，后面再按真实验证情况收敛。

## 阶段文档

当前阶段信息主要维护在以下文档中：

- [备忘录](memo.md)：已确认决策、发布形态、CLI 命令原则、桌面端前置待办和历史阶段摘要。
- [架构设计](architecture.md)：系统分层、包级依赖和核心边界。
- [技术设计](technical-design.md)：AgentGateway、AgentOrchestrator、PiAdapter、Tool Boundary 和 Trace Store。
- [第一阶段技术方案](technical-plan-mvp.md)：MVP 技术路线、仓库拆分、模块设计、里程碑和验收标准。
- [NPM Release](../docs/npm-release.md)：CLI npm 发布和验证命令。
