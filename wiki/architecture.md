# 架构设计

## 当前方向

Potato 是 Pi 的非入侵增强层，而不是独立 Coding Agent runtime。

默认执行路径：

```text
@potato/cli -> Pi public main() -> Pi CLI/TUI/runtime
```

Pi 拥有 TUI、agent loop、session、tools、skills、themes、模型选择、上下文压缩和后续 runtime 行为。Potato 只负责启动前检查、可选增强、发布包装和少量不替代 Pi 行为的辅助命令。

## 核心决策

Potato 通过 `@earendil-works/pi-coding-agent` 的公开 `main(args, { extensionFactories })` 入口启动 Pi。普通 Pi 参数必须原样透传，包括未知的未来 Pi 参数。

Potato 不再维护：

- 自研 Ink TUI。
- 自研 prompt editor。
- 自研 AgentSession / AgentLoop / AgentOrchestrator。
- Pi RPC 事件到 Potato protocol 的转换层。
- AI SDK 替代 runtime。
- 默认生成的 `.pi/agents` 或 `.potato/runtime/*.ts`。

## 包级架构

当前 workspace 只保留 CLI 包：

```text
cli/  @potato/cli
```

`@potato/cli` 的职责：

- 识别 Potato 自有 helper command，例如 `doctor`、`enhancements`、`version`。
- 对普通 agent 使用场景调用 Pi public `main()`。
- 将 optional Potato extension factories 传给 Pi。
- 发布 npm wrapper 包。

`core/` 和 `protocol/` 已移除。它们属于旧的并行 runtime/event 架构，不再符合当前目标。

## Helper Commands

当前 Potato 自有命令：

- `potato doctor`：检查 Node 版本和 Pi public main export。
- `potato enhancements`：展示当前 Potato 增强状态。
- `potato version`：展示 Potato 版本。

其它参数默认透传给 Pi。

## 增强边界

Potato enhancement 必须满足：

- 默认不写 `.pi/`。
- 默认不替换 Pi system prompt。
- 不依赖 Pi 私有文件路径。
- 不依赖未文档化 raw event schema。
- 失败时优先降级或禁用 enhancement，而不是阻止 Pi 启动，除非用户执行的是严格检查命令。
