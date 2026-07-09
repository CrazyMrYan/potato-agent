# 第一阶段技术方案

## 目标

第一阶段目标是交付一个可发布的 Pi wrapper CLI：

```text
potato -> Pi public main() -> Pi native TUI/runtime
```

Potato 不再构建独立 Coding Agent runtime。它只验证 wrapper、doctor、发布包装和可选增强入口。

## 技术路线

- TypeScript + Node.js。
- 单 workspace package：`cli/`。
- 直接依赖 `@earendil-works/pi-coding-agent`。
- 普通参数透传给 Pi `main(args, { extensionFactories })`。
- Potato helper command 在进入 Pi 前处理。

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
pnpm --filter @potato/cli dev -- doctor
```
