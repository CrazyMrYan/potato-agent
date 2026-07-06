# 项目阶段状态

## 当前阶段

当前处于“第一阶段执行验证：M5 trace/diff 与 SDK/runtime 权限验证开发中”。

已经确定：

- 当前仓库 `coding-agent` 是单一工作区仓库。
- `wiki/` 存放知识库和阶段记录。
- `protocol/` 只承载协议契约，不承载核心实现逻辑。
- `core/` 承载 `AgentGateway`、`AgentOrchestrator`、`PiAdapter`、Pi 事件映射和会话适配。
- `cli/` 是第一阶段验证壳，只负责命令解析、终端交互和渲染。
- Pi 作为底层智能体执行引擎。
- 本项目自己的产品能力沉在 `core/` 的 `AgentOrchestrator`。
- CLI 已接入 `@earendil-works/pi-coding-agent` 的 `RpcClient`。
- 当前真实 Pi 路径使用 `PiRpcAdapter` 启动 Pi RPC 子进程。
- CLI 已支持一次性 `run` 和持久 RPC 会话的 `chat`。
- 协议已补充 `assistant.delta`，用于承载 Pi 输出的正文片段和 thinking 片段。
- Pi 工具事件会提取 `args` 中的关键参数，例如 `read` 的文件路径和 `bash` 的命令。
- M4 已把 CLI 主入口改成交互式 TUI，并把运行时模型配置、会话创建能力继续收敛到 `core/`。
- M4.6 已按最新决策把 TUI 技术栈从 `@vue-tui/runtime` 切换为 Ink v7，其余核心架构不变。
- M4.5 已把系统提示词、追加系统提示词、skills、MCP server 描述、工具 allow/deny 和权限策略纳入 `core/` 的 `AgentConfig`。
- 当前 Pi RPC 路径可通过 Pi CLI 参数真实传入 `systemPrompt`、`appendSystemPrompt`、`skills` 和工具 allow/deny。
- Trace 是默认自动开启的任务审计记录，用于复盘、调试、回放和问题定位；`run`、`chat` 和 TUI session 都应写入 `.coding-agent/traces/`。
- Diff 是当前 Git 工作区变更视图，用于让用户看到 agent 或人工操作造成的文件变化；TUI 和 CLI 都应能随时查看。
- TUI 已提供 `/diff`、`/trace` 和 `/mode manual|auto|readonly` 入口，权限模式保存到 workspace 配置。
- TUI 开始补齐核心配置入口：`/mode` 进入二级选择器，`/skill` 进入可操作列表，`/mcp` 检测配置，`/agent` 展示 SubAgent 入口。
- Core 已新增 `AgentLoop`，用于统一任务生命周期、trace、diff 和 runtime capability 记录。
- Core 已新增 `SkillManager` 和内置 skills registry，支持内置 skill 开关、本地 skill 安装、Git 仓库 skill 安装。
- Core 已新增 `McpConfigChecker`，用于检测 MCP command、env、startup 和当前 adapter 支持状态。
- MCP server 配置和真正的工具二次确认策略已经有 core 模型，但还没有在 Pi RPC 形态下完全生效；后续需要切到 Pi SDK session 或本项目 runtime 来接管工具边界。
- CLI/TUI 不再给模型输出增加“步骤：”“推理：”“工具开始：”这类固定前缀，模型最终输出按原文展示。
- TUI 已移除右侧伪滚动条；当前保留 PageUp/PageDown 历史翻页和终端原生滚动，真实滚轮/滚动条需要更完整 TUI 能力或 runtime 支持。
- 独立 `coding-agent-runtime` 仓库仍作为后续演进方向。
- 桌面端启动前需要评估通用模型适配层：优先考虑 OpenAI-compatible 配置、LiteLLM、Vercel AI SDK 或 OpenRouter；当前 Pi RPC 路径暂不把这些作为核心依赖。

## 阶段文档

当前阶段信息分散在以下文档中：

- [架构设计](architecture.md)：记录系统分层和核心边界。
- [技术设计](technical-design.md)：记录 AgentGateway、AgentOrchestrator、PiAdapter、Tool Boundary 和 Trace Store。
- [第一阶段技术方案](technical-plan-mvp.md)：记录 MVP 技术路线、仓库拆分、模块设计、里程碑和验收标准。

## 工作区布局

项目使用单一 Git 仓库和 pnpm workspace 管理多个包：

```text
/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/
  wiki/      # 知识库和阶段记录
  protocol/  # @coding-agent/protocol
  core/      # @coding-agent/core
  cli/       # @coding-agent/cli
```

旧的 sibling 仓库 `coding-agent-cli/` 和 `coding-agent-protocol/` 是前期验证遗留目录，当前目标结构以本仓库子目录为准。

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

## 下一步

下一步是完成 M6 core 体验闭环，并继续以 CLI/TUI 验证 core 能力是否真实生效：

1. 自动上下文压缩：在 core 里增加上下文预算、压缩触发、压缩摘要和压缩 trace。
2. 环形上下文额度展示：CLI/TUI 展示当前上下文占用、压缩阈值和最近一次压缩状态。
3. Markdown 渲染：CLI/TUI 支持模型输出中的标题、列表、代码块、引用、表格的终端友好渲染。
4. 手动权限继续收敛：拒绝即暂停、写入前 diff 预览和审批 trace 保持可见。
5. SubAgent 真实委派继续增强：在 CLI/TUI 展示当前 SubAgent、任务状态和技能选择来源。
6. MCP 从配置检测走向可注入能力：在 Pi RPC 不支持真实注入时明确展示 capability 限制。
7. 为桌面端前置模型适配评估，但不在 M6 绑定 LiteLLM/AI SDK。

上一阶段 M5 trace/diff 与 SDK/runtime 权限验证仍保留以下长期方向：

1. 完成 `JsonlTraceStore` 和 Git-backed `DiffService`。
2. 增加 `agent trace` 和 `agent diff`。
3. `agent run` 和 TUI 任务执行后记录 trace。
4. 通过 Git diff 生成 `ChangeSet`。
5. 落地独立可测试的 `ToolBoundary`。
6. 当前 RPC 路径只能透传 system prompt、skills 和工具 allow/deny，不能声明 core 已接管最终工具权限。
7. 后续只有 SDK/runtime adapter 能在工具执行前调用 `ToolBoundary` 时，才能声明权限由本项目接管。
8. 写入前展示 patch 并要求确认属于 SDK/runtime 工具接管能力，不属于当前 RPC 路径已完成能力。
9. 后续需要把 SDK/runtime adapter 接入 `AgentLoop`，让 MCP 和工具权限从“配置检测”进入“真实执行”。

### M4.5：TUI 输出修正和 core 运行配置模型

状态：已完成。

调整原因：

- 终端输出不应该强行套固定文案，模型输出什么就应该展示什么。
- CLI/TUI 不能继续承载系统提示词、skill、MCP、工具权限等核心能力。
- 右侧文本滚动条只是装饰，不具备真实滚动能力，容易误导。
- 去掉固定文本前缀后，TUI 上色不能再依赖中文前缀判断。

实现结果：

- `core/src/config/AgentConfig.ts` 新增运行配置模型：
  - `systemPrompt`
  - `appendSystemPrompt`
  - `skills`
  - `mcpServers`
  - `tools`
  - `permissionPolicy`
- `core/` 新增 `DEFAULT_AGENT_PERMISSION_POLICY`：
  - 默认允许只读工具：`read`、`ls`、`grep`、`find`
  - 默认需要确认的变更工具：`bash`、`edit`、`write`
  - 默认不进入完全放开模式
- `core/` 新增 `buildPiRpcArgs`，把当前 Pi CLI 已支持的配置转成 RPC 启动参数：
  - `--system-prompt`
  - `--append-system-prompt`
  - `--skill`
  - `--tools`
  - `--exclude-tools`
  - `--no-tools`
  - `--no-builtin-tools`
- `PiRpcAdapter` 和 `PiRpcSessionAdapter` 会把上述参数传入 `RpcClientOptions.args`。
- `EventStreamRenderer` 新增结构化渲染结果 `RenderedAgentEvent`，TUI 按事件 kind 上色，不再靠中文前缀判断。
- `EventStreamRenderer` 不再输出“步骤：”“推理：”“工具开始：”“工具完成：”“任务失败：”等固定标签。
- TUI 事件列表改为 `{ kind, text }`，去掉右侧伪滚动条，并根据终端高度调整可见事件行数。

当前边界：

- 系统提示词、skills 和工具 allow/deny 在当前 Pi RPC 路径下可以通过 Pi CLI 参数传入。
- MCP server 描述已进入 core 配置模型，但 Pi RPC CLI 参数没有直接 MCP server 入口；真正接入需要后续 SDK/runtime。
- 工具二次确认策略已进入 core 配置模型，但当前 Pi RPC 子进程内部仍执行自己的工具策略；要完全由本项目控制，需要后续 Tool Boundary 或 SDK/runtime 适配。

验证结果：

- 新增 `core/tests/agent-runtime-config.test.ts`。
- 新增 `cli/tests/tui-render.test.ts`。
- 更新 `cli/tests/stream-renderer.test.ts`。

### M4.6：Ink v7 TUI 迁移

状态：已完成。

调整原因：

- `@vue-tui/runtime` 当前体验不满足 agent 终端需求。
- 当前项目继续保持 Node.js / TypeScript / pnpm workspace，不切 Bun，不引入 OpenTUI。
- 用户明确选择 Ink v7，其余架构保持不变。

实现结果：

- `cli/` 移除 `@vue-tui/runtime` 和 `vue`。
- `cli/` 引入 Ink v7、React 19、`react-devtools-core`、`@types/react` 和 `ink-testing-library`。
- `AgentTui` 改为 React/Ink TSX 组件。
- 默认 `agent` 入口改为使用 Ink `render` 启动 TUI。
- 根目录新增 `pnpm run dev`，直接转发到 `@coding-agent/cli dev`，避免在根目录运行时没有入口或误用旧产物。
- 运行时模型配置、slash command、事件列表、PageUp/PageDown 历史翻页等现有能力保持不变。
- `EventStreamRenderer` 仍然是 CLI 事件文本格式化层，TUI 只消费结构化 `{ kind, text }`。
- TUI 首屏改为带边框状态区、无边框 transcript 区和带边框 input 行；正文输出区不加边框，减少复制模型内容时带出框线。

验证结果：

- `pnpm --filter @coding-agent/cli test` 通过。
- `pnpm --filter @coding-agent/cli typecheck` 通过。
- `pnpm run dev --help` 会从根目录进入 CLI dev 入口。

### M3.5：工具详情、推理片段和多轮交互

状态：已完成。

实现目录：

- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/protocol`
- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/core`
- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/cli`

新增能力：

- `protocol/` 新增 `assistant.delta` 事件，`channel` 区分 `text` 和 `thinking`。
- `PiEventMapper` 统一转换 Pi RPC 原始事件。
- `tool_execution_start` 会从 Pi 的 `args` 提取关键信息：
  - `read` 展示读取文件路径。
  - `bash` 展示执行命令。
  - `ls`、`grep`、`find`、`edit`、`write` 展示对应摘要。
- `tool_execution_end` 会尽量提取工具输出摘要。
- `EventStreamRenderer` 会合并连续的正文和 thinking delta，避免逐 token 逐行输出。
- 工具结果会压缩成单行摘要，避免长文件内容和命令输出打散终端结构。
- `agent chat` 使用同一个 Pi RPC 子进程持续多轮对话，不再每次输入都重新初始化会话。
- `chat` 支持 `/exit` 或 `/quit` 退出。

交互命令：

```text
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent

pnpm --filter @coding-agent/cli dev chat \
  --provider deepseek \
  --model deepseek-reasoner \
  --workspace /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/protocol
```

说明：

- thinking 内容是否存在取决于 Pi RPC 是否收到模型/供应商返回的 thinking content。
- 当前 CLI 只做结构化终端输出，不做复杂 TUI。
- 这一步解决的是“同一会话多轮输入”和“事件里不要丢工具关键参数”，不是完整桌面端 UI。

## 执行验证记录

### M4：TUI 交互壳和 core 配置收敛

状态：已完成。

目标：

- 默认运行 `agent` 进入交互式 TUI。
- TUI 只承载已有能力：状态栏、事件流、输入区、运行时模型配置和退出。
- 不新增桌面端、复杂文件浏览器、图形 diff、多 tab 或插件能力。
- 工作区默认使用启动目录。
- 模型配置可以在运行时输入，而不是必须启动时通过参数传入。
- 配置解析、供应商环境变量映射和 session 创建能力向 `core/` 收敛。

技术选择：

- 当前使用 Ink v7 作为 CLI TUI 层。
- 历史实现曾使用 `@vue-tui/runtime`，M4.6 已迁移到 Ink v7。
- 保留 commander 作为命令入口和兼容命令解析。
- 保留现有 `EventStreamRenderer` 作为事件文本格式化基础，TUI 负责布局。

边界：

- `core/`：`AgentConfig`、`AgentConfigStore`、`AgentSessionFactory`、`resolvePiAdapterOptions`。
- `cli/`：TUI 状态、输入框、状态栏、事件列表、命令入口。
- `protocol/`：本阶段不增加协议类型，除非实现中发现事件模型缺口。

后续顺延：

- Trace/diff 调整到 M5。
- Tool Boundary 和权限策略调整到 M6。

实现结果：

- 新增 `core/src/config/AgentConfig.ts` 和 `core/src/config/AgentConfigStore.ts`。
- 新增 `core/src/session/AgentSession.ts` 和 `core/src/session/AgentSessionFactory.ts`。
- `chat` 兼容命令改为通过 `AgentSessionFactory` 创建会话，不再直接 new Pi session adapter。
- CLI 引入 Ink TUI，默认 `agent` 入口进入交互式界面。
- TUI 默认 workspace 会从启动目录向上寻找 Git 根目录；从 `cli/dist` 直接启动也应落到项目根。
- TUI 启动时确保生成 `<workspace>/.coding-agent/config.json`。
- TUI 支持 `Ctrl+M` 打开模型配置选择器，用方向键选择 provider 和 model，并可输入 API Key。
- TUI 支持输入 `/` 弹出命令候选菜单，可选择 `/model`、`/workspace`、`/exit`。
- TUI 支持 `Ctrl+W` 查看工作区、`Ctrl+C` 退出。
- TUI 事件区按内容类型上色：用户输入、步骤、推理、工具、成功、失败使用不同颜色。
- TUI 事件区支持 `PageUp/PageDown` 或空输入时 `↑/↓` 翻页，不再显示伪滚动条。
- TUI 事件区和输入区不使用边框，减少复制内容时带出框线。
- TUI 使用 React ref 保存 `AgentSession`，避免 UI runtime 代理 Pi RPC client。
- Commander 只保留为默认入口、`run` 和 `chat` 兼容命令的薄路由层，模型配置不再放在默认启动参数里。

验证结果：

- `pnpm --filter @coding-agent/core test` 通过。
- `pnpm --filter @coding-agent/cli test` 通过。
- `pnpm --filter @coding-agent/cli typecheck` 通过。

### M3.7：模型配置能力下沉到 core

状态：已完成。

调整原因：

- CLI 应该只负责命令参数读取、终端输入和终端渲染。
- provider、model、API Key、供应商环境变量映射属于核心运行配置，后续桌面端也需要复用。

调整结果：

- 新增 `core/src/pi/resolvePiAdapterOptions.ts`。
- `@coding-agent/core` 导出 `resolvePiAdapterOptions` 和 `ModelConfigInput`。
- `cli/` 不再保留独立模型配置解析文件。
- `run` 和 `chat` 命令仍保持原有参数形态，不改变用户使用方式。

验证结果：

- `pnpm typecheck` 通过。
- `pnpm test` 通过。

### M3.6：单仓库 workspace 迁移和 core 拆分

状态：已完成。

当前结构：

```text
/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/
  wiki/
  protocol/
  core/
  cli/
```

迁移结果：

- `protocol/` 是 `@coding-agent/protocol`。
- `core/` 是 `@coding-agent/core`，包含 `AgentGateway`、`AgentOrchestrator`、`PiAdapter`、`PiRpcAdapter`、`PiRpcSessionAdapter`、`PiEventMapper`。
- `core/` 负责模型配置解析、供应商凭证映射和 Pi adapter option 组装。
- `cli/` 是 `@coding-agent/cli`，只包含命令入口、终端输入、终端渲染和 CLI 测试。
- 根目录新增 `pnpm-workspace.yaml` 和 workspace 脚本。

验证命令：

```text
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent

pnpm typecheck
pnpm test
pnpm build
pnpm --filter @coding-agent/cli dev --help
```

结果：

- `protocol/`、`core/`、`cli/` 的类型检查、测试和构建均通过。
- 新路径下 CLI 能正常显示 `run` 和 `chat` 命令。

### M1-M2：协议和 CLI 骨架历史记录

状态：已完成。

说明：

M1-M2 最初在 sibling 仓库中验证，M3.6 已迁入当前单仓库 workspace。以下路径和提交只作为历史记录，不再代表当前目标结构。

历史实现仓库：

- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol`
- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli`

提交记录：

- `coding-agent-protocol`: `0f808a3 feat: initialize protocol contracts`
- `coding-agent-cli`: `8949599 feat: initialize cli skeleton`

历史验证命令：

```text
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol && pnpm test && pnpm typecheck && pnpm build
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli && pnpm test && pnpm typecheck && pnpm dev run "测试任务" && pnpm build
```

结果：

- 历史 `coding-agent-protocol` 类型、测试和构建通过。
- 历史 `coding-agent-cli` 可以通过 `FakePiAdapter` 输出完整模拟事件流。
- `agent run "测试任务"` 已输出任务开始、步骤、工具调用、diff 和任务完成事件。
- 当时还没有接入 trace、diff 命令、权限策略、工具边界和真实 Pi。

下一步：

- 为 trace 和 diff 建立下一份 Superpowers 执行计划。
- 继续维护 `wiki/` 中的阶段状态和验证结果。

### M3：模型配置和 Pi RPC 接入

状态：已完成配置能力和事件级流式输出；真实模型调用等待有效 API Key。

实现目录：

- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/core`
- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/cli`

新增能力：

- `agent run` 默认使用 Pi，不再暴露 `--adapter` 参数。
- 必须提供 `--provider` 和 `--model`。
- 支持通过 `--api-key` 传入模型凭证。
- 支持从供应商环境变量读取模型凭证。
- 已支持 DeepSeek 的 `DEEPSEEK_API_KEY` 凭证映射。
- Pi 适配器通过 `RpcClient` 启动 Pi RPC 子进程。
- `PiRpcAdapter` 使用 `onEvent + prompt + waitForIdle` 实时转发 Pi 事件。
- CLI 能展示 Pi 启动步骤和 Pi 失败事件。
- 如果 agent 产生 `task.failed`，CLI 退出码为非 0。

当前支持的凭证映射：

| provider | 环境变量 |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `google` / `gemini` | `GOOGLE_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |

模型配置命令：

```text
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent

pnpm --filter @coding-agent/cli dev run "只读说明这个项目的目录结构，不要修改文件" \
  --provider deepseek \
  --model deepseek-chat \
  --workspace /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/protocol
```

也可以显式传入凭证：

```text
pnpm --filter @coding-agent/cli dev run "只读说明这个项目的目录结构，不要修改文件" \
  --provider deepseek \
  --model deepseek-chat \
  --api-key "$DEEPSEEK_API_KEY" \
  --workspace /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent/protocol
```

验证命令：

```text
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent

pnpm test
pnpm typecheck
pnpm build
```

验证结果：

- 当前 workspace 测试、类型检查和构建通过。
- 未提供对应供应商 API Key 时，CLI 会在配置层直接失败，并提示需要哪个环境变量或 `--api-key`。
- 使用无效 `--api-key invalid-test-key` 时，CLI 已进入 Pi RPC 路径，输出 `步骤：启动 Pi RPC：deepseek/deepseek-chat`。
- 当前已实现事件级流式输出：Pi 的 step/tool 事件到达后会即时转发到 CLI。
- 当前尚未实现文本级 token/delta 流式输出；最终回答仍通过 `task.finished` 展示。

当前状态：

- 本机没有可用于真实模型调用的 API Key。
- 当前 Node.js 已升级到 `v24.18.0`，满足 Pi 包声明的 `>=22.19.0` 要求。
- DeepSeek 无 key 时会在配置层提示需要 `DEEPSEEK_API_KEY` 或 `--api-key`。
- 传入测试 key 时可以进入 `步骤：启动 Pi RPC：deepseek/deepseek-chat`，这只证明本项目封装已进入 Pi 层，不证明真实模型调用成功。

下一步：

1. 配置真实模型凭证，例如 `DEEPSEEK_API_KEY`。
2. 对一个非本项目仓库执行只读任务，确认 Pi 能读取目录结构并返回总结。
3. 再执行一个小范围写入任务，验证 diff、失败退出码和后续 trace 设计。
