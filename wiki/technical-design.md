# 技术设计

## 设计目标

Potato 当前目标是成为 Pi 的非入侵 wrapper/enhancer，而不是独立 Coding Agent runtime。

关键要求：

- `potato` 默认进入 Pi 原生 TUI。
- Pi 支持的 flags 通过 `potato` 原样透传。
- Potato 不维护独立 agent loop、session、工具边界或事件协议。
- Potato helper commands 不启动 Pi 交互 runtime。
- Potato 增强通过 Pi public extension API 注入，不写 `.pi/`，不生成 runtime TS 文件。
- 发布包运行时依赖 `@earendil-works/pi-coding-agent`。

## 执行路径

```text
cli/src/cli.ts
  -> helper command? run Potato helper
  -> otherwise cli/src/pi/launchPi.ts
  -> @earendil-works/pi-coding-agent main(args, { extensionFactories })
```

`launchPi()` 是唯一的 Pi 启动封装。它接受 dependency injection，方便测试参数透传。

如果用户传入 Pi 的 `--no-extensions` 或 `-ne`，`launchPi()` 不注入 Potato enhancement factories；显式测试注入的 factories 仍按测试 override 使用。

## 文件职责

```text
cli/src/cli.ts
  轻量路由。识别 doctor/enhancements/version，其它参数加载 Potato config 后交给 Pi。

cli/src/pi/launchPi.ts
  调用 Pi public main()，传入原始 args 和 extensionFactories。

cli/src/commands/doctor.ts
  非交互检查 Node 版本、Pi public main export、Potato extension factories 和默认 approval。

cli/src/config/potatoConfig.ts
  读取 `.potato/config.json`，只处理 Potato enhancement config。

cli/src/enhancements/approval.ts
  默认启用的 `tool_call` hook，确认 bash/edit/write 等变更型工具。

cli/src/enhancements/mcp.ts
  连接配置的 MCP stdio server，把 MCP tools 注册成 Pi tools。

cli/src/enhancements/subagent.ts
  注册 `potato_subagent` tool，用独立 Pi RPC session 执行配置的 subagent。
```

## 配置

实际项目配置放在 `.potato/config.json`，该目录被 gitignore。提交用样例放在 `docs/potato-config.example.json`。

当前支持：

- `enhancements.approval`: boolean，默认 `true`。
- `enhancements.mcpServers`: MCP stdio server 列表。
- `enhancements.subagents`: 通过 `potato_subagent` 暴露的 agent 列表。

## 测试策略

重点测试行为：

- 普通 Pi 参数原样传给 `launchPi()`。
- `doctor` 不调用 Pi main。
- `launchPi()` 把 args 和 extensionFactories 原样传给 Pi `main()`。
- `--no-extensions` / `-ne` 关闭 Potato 默认 enhancement 注入。
- approval 注册 `tool_call` hook 并拦截变更型工具。
- MCP bridge 从配置 server 注册 tools，并把调用转发给 MCP client。
- subAgent 配置后注册 `potato_subagent` tool。
- `.potato/config.json` 被读取、规范化，并传给 Pi launcher。
- 发布脚本 external 掉 Pi，并把 Pi 作为运行时 dependency 写入 release package。

## 删除的旧设计

旧设计中的以下部分已经移除：

- `protocol/` 事件协议。
- `core/` Agent runtime 和 Pi RPC adapter。
- Ink/React 自研 TUI。
- EventStreamRenderer、PromptEditor、DiffRenderer。
- RuntimeSessionAdapter / RuntimeTaskAdapter。

这些能力现在由 Pi 直接拥有。
