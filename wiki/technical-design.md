# 技术设计

## 设计目标

Potato 当前目标是成为 Pi 的薄包装器和增强层。

关键要求：

- `potato` 默认进入 Pi 原生 TUI。
- Pi 支持的 flags 通过 `potato` 原样透传。
- Potato 不维护独立 agent loop、session、工具边界或事件协议。
- Potato helper commands 不启动 Pi 交互 runtime。
- 发布包运行时依赖 `@earendil-works/pi-coding-agent`。

## 执行路径

```text
cli/src/cli.ts
  -> helper command? run Potato helper
  -> otherwise cli/src/pi/launchPi.ts
  -> @earendil-works/pi-coding-agent main(args, { extensionFactories })
```

`launchPi()` 是唯一的 Pi 启动封装。它接受 dependency injection，方便测试参数透传。

## 文件职责

```text
cli/src/cli.ts
  轻量路由。识别 doctor/enhancements/version，其它参数交给 Pi。

cli/src/pi/launchPi.ts
  调用 Pi public main()，传入原始 args 和 extensionFactories。

cli/src/commands/doctor.ts
  非交互检查 Node 版本和 Pi public main export。
```

## 测试策略

重点测试行为：

- 普通 Pi 参数原样传给 `launchPi()`。
- `doctor` 不调用 Pi main。
- `launchPi()` 把 args 和 extensionFactories 原样传给 Pi `main()`。
- 发布脚本 external 掉 Pi，并把 Pi 作为运行时 dependency 写入 release package。

## 删除的旧设计

旧设计中的以下部分已经移除：

- `protocol/` 事件协议。
- `core/` Agent runtime 和 Pi RPC adapter。
- Ink/React 自研 TUI。
- EventStreamRenderer、PromptEditor、DiffRenderer。
- RuntimeSessionAdapter / RuntimeTaskAdapter。

这些能力现在由 Pi 直接拥有。
