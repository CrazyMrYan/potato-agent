# 项目阶段状态

## 当前阶段

当前处于“第一阶段执行验证：M1-M2 已完成”。

已经确定：

- 当前仓库 `coding-agent` 是知识库和总控仓库。
- 第一阶段不在当前仓库直接写实现代码。
- 第一阶段实现仓库拆为 `coding-agent-protocol` 和 `coding-agent-cli`。
- Pi 作为底层智能体执行引擎。
- 本项目自己的产品能力沉在 `AgentOrchestrator`。
- CLI 是第一阶段验证壳。
- 第一版使用进程内 `InProcessPiAdapter`。
- 独立 runtime 子进程只作为后续演进方向。

## 阶段文档

当前阶段信息分散在以下文档中：

- [架构设计](architecture.md)：记录系统分层和核心边界。
- [技术设计](technical-design.md)：记录 AgentGateway、AgentOrchestrator、PiAdapter、Tool Boundary 和 Trace Store。
- [第一阶段技术方案](technical-plan-mvp.md)：记录 MVP 技术路线、仓库拆分、模块设计、里程碑和验收标准。

## 工作区布局

项目使用一个父级工作区目录管理多个独立 Git 仓库：

```text
/Users/yanjiahui/Desktop/coding-agent-workspace/
  coding-agent/           # 知识库和总控仓库
  coding-agent-protocol/  # 协议类型仓库
  coding-agent-cli/       # CLI 验证壳仓库
```

这些仓库保持 Git 历史独立，不合并成 monorepo。

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

下一步是继续执行验证第一阶段的后续能力：

1. 为 trace 和 diff 写独立执行计划。
2. 加入 `JsonlTraceStore`、`agent trace` 和 `agent diff`。
3. 为工具边界和权限策略写独立执行计划。
4. 接入文件、搜索、Git、Shell 工具。
5. 最后接入真实 Pi。

## 执行验证记录

### M1-M2：协议仓库和 CLI 骨架

状态：已完成。

实现仓库：

- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol`
- `/Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli`

提交记录：

- `coding-agent-protocol`: `0f808a3 feat: initialize protocol contracts`
- `coding-agent-cli`: `8949599 feat: initialize cli skeleton`

验证命令：

```text
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-protocol && pnpm test && pnpm typecheck && pnpm build
cd /Users/yanjiahui/Desktop/coding-agent-workspace/coding-agent-cli && pnpm test && pnpm typecheck && pnpm dev run "测试任务" && pnpm build
```

结果：

- `coding-agent-protocol` 类型、测试和构建通过。
- `coding-agent-cli` 可以通过 `FakePiAdapter` 输出完整模拟事件流。
- `agent run "测试任务"` 已输出任务开始、步骤、工具调用、diff 和任务完成事件。
- 当前还没有接入 trace、diff 命令、权限策略、工具边界和真实 Pi。

下一步：

- 为 trace 和 diff 建立下一份 Superpowers 执行计划。
- 继续维护 `wiki/` 中的阶段状态和验证结果。
