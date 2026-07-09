# 项目阶段状态

## 当前状态

项目已重构为 Pi Main Wrapper 方向。

当前执行路径：

```text
@potato/cli -> Pi public main() -> Pi CLI/TUI/runtime
```

当前已具备：

- `potato` 默认把普通参数交给 Pi public `main()`。
- 无参数运行进入 Pi 原生 TUI。
- `potato --print ...`、`potato --mode rpc ...` 等 Pi 参数由 Pi 处理。
- `potato doctor` 做非交互兼容性检查。
- `potato enhancements` 展示 Potato 增强状态。
- npm release build external 掉 Pi，并在 release package 中声明 Pi runtime dependency。

## 当前边界

Potato 不再提供：

- 自研 TUI。
- 自研 AgentLoop、AgentSession、AgentOrchestrator。
- 自研 protocol event stream。
- AI SDK runtime adapter。
- 默认生成 Pi extension 文件或 `.pi/agents`。

Pi 拥有 TUI、runtime、tools、skills、session、compaction 和 agent behavior。Potato 只拥有 wrapper、doctor、packaging 和可选 enhancement factories。

## 验收重点

- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build:npm:cli`
- `pnpm --filter @potato/cli dev -- --help`
- `pnpm --filter @potato/cli dev -- doctor`
