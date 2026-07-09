# 备忘录

## 已确认架构决策

- Potato 是 Pi 的非入侵 wrapper/enhancer。
- 默认路径是 `@potato/cli -> Pi public main() -> Pi CLI/TUI/runtime`。
- Pi 拥有 TUI、runtime、sessions、tools、skills、model selection、compaction 和 agent behavior。
- Potato 自有代码只做 launcher、doctor、enhancement factories、release packaging 和少量 helper commands。
- `core/` 和 `protocol/` 已移除。
- CLI 直接依赖 `@earendil-works/pi-coding-agent`。
- npm 发布包 external 掉 Pi，并保留 Pi 运行时依赖。

## 维护规则

- 新功能优先通过 Pi public API 或 extension API 实现。
- 不依赖 Pi 私有文件路径。
- 不把 raw Pi event schema 固化为 Potato protocol。
- 不默认写 `.pi/`。
- 不默认替换 Pi system prompt。
- 文档必须描述当前 wrapper 架构，不再描述旧的 Pi RPC 编排层。

## 历史说明

早期实现曾包含 `protocol/`、`core/`、Ink TUI、Pi RPC adapter、trace、diff、approval bridge、MCP bridge 和 AI SDK runtime 实验路径。这些属于旧的并行 runtime 方向，已经被 Pi Main Wrapper 方向取代。
