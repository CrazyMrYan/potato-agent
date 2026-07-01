# 项目阶段状态

## 当前阶段

当前处于“第一阶段执行验证设计”。

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

下一步是执行验证第一阶段：

1. 创建 `coding-agent-protocol`。
2. 创建 `coding-agent-cli`。
3. 用 `FakePiAdapter` 跑通 CLI 事件流。
4. 加入 trace、diff、权限和工具边界。
5. 最后接入真实 Pi。
