# 第一阶段技术方案

## 目标

当前目标是交付一个可发布的 Pi wrapper CLI，并通过 Pi extension API 提供 Potato 自有增强：

```text
potato -> Pi public main() -> Pi native TUI/runtime
```

Potato 不再构建独立 Coding Agent runtime。Pi 拥有 TUI、runtime、session、tools、skills 和模型行为；Potato 只拥有 wrapper、doctor、发布包装和 enhancement factories。

## 技术路线

- TypeScript + Node.js。
- 单 workspace package：`cli/`。
- 直接依赖 `@earendil-works/pi-coding-agent`。
- 普通参数透传给 Pi `main(args, { extensionFactories })`。
- Potato helper command 在进入 Pi 前处理。
- 默认 approval hook 通过 Pi UI 确认 `bash`、`edit`、`write`。
- `.potato/config.json` 显式配置 MCP bridge 和 subAgent。
- `--no-extensions` / `-ne` 关闭本次 Potato enhancement 注入。

## 当前目录结构

```text
coding-agent/
  cli/   @potato/cli
  docs/  specs and plans
  wiki/  project knowledge base
```

## 验证命令

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm build:npm:cli
pnpm --filter @potato/cli dev -- --help
pnpm --filter @potato/cli dev -- enhancements
pnpm --filter @potato/cli dev -- doctor
node --test scripts/tests/*.test.mjs
```
