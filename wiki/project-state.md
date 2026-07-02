# 项目阶段状态

## 当前阶段

当前处于“第一阶段执行验证：M4 TUI 交互壳和 core 配置收敛已完成，下一步进入 M5 trace/diff”。

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
- M4 已把 CLI 主入口改成 Vue TUI，并把运行时模型配置、会话创建能力继续收敛到 `core/`。
- 独立 `coding-agent-runtime` 仓库仍作为后续演进方向。

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

下一步是执行 M5 trace/diff：

1. 为 trace 和 diff 写独立执行计划。
2. 加入 `JsonlTraceStore`。
3. 增加 `agent trace` 和 `agent diff`。
4. `agent run` 和 TUI 任务执行后记录 trace。
5. 通过 Git diff 生成 `ChangeSet`。

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

- 使用 `@vue-tui/runtime` 作为 CLI TUI 层。
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
- CLI 引入 Vue TUI，默认 `agent` 入口进入交互式界面。
- TUI 默认 workspace 会从启动目录向上寻找 Git 根目录；从 `cli/dist` 直接启动也应落到项目根。
- TUI 启动时确保生成 `<workspace>/.coding-agent/config.json`。
- TUI 支持 `Ctrl+M` 打开模型配置选择器，用方向键选择 provider 和 model，并可输入 API Key。
- TUI 支持输入 `/` 弹出命令候选菜单，可选择 `/model`、`/workspace`、`/exit`。
- TUI 支持 `Ctrl+W` 查看工作区、`Ctrl+C` 退出。
- TUI 事件区按内容类型上色：用户输入、步骤、推理、工具、成功、失败使用不同颜色。
- TUI 事件区支持 `PageUp/PageDown` 或空输入时 `↑/↓` 滚动，并显示右侧文本滚动条。
- TUI 事件区和输入区不使用边框，减少复制内容时带出框线。
- TUI 使用 `shallowRef` 和 `markRaw` 保存 `AgentSession`，避免 Vue 代理 Pi RPC client 导致第二轮对话出现 `Illegal invocation`。
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
