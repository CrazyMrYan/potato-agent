import { describe, expect, it } from "vitest";
import type { AgentEvent, ApprovalDecision, AssistantMessageDeltaEvent, ChangeSet, RunTaskInput, SubAgentSelectedEvent } from "../src/index.js";

describe("protocol exports", () => {
  it("defines task, event, approval, and changeset contracts", () => {
    const input: RunTaskInput = {
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "修复测试失败",
      mode: "run",
      approvalMode: "manual"
    };

    const decision: ApprovalDecision = { type: "allow" };
    const changeSet: ChangeSet = { files: [{ path: "src/a.ts", status: "modified" }] };
    const event: AgentEvent = {
      type: "task.started",
      taskId: input.taskId,
      workspacePath: input.workspacePath,
      prompt: input.prompt
    };
    const assistantDelta: AssistantMessageDeltaEvent = {
      type: "assistant.delta",
      taskId: input.taskId,
      channel: "thinking",
      text: "正在分析目录结构"
    };
    const selected: SubAgentSelectedEvent = {
      type: "subagent.selected",
      taskId: input.taskId,
      subAgentId: "reviewer",
      name: "Reviewer",
      description: "Review code"
    };

    expect(input.mode).toBe("run");
    expect(decision.type).toBe("allow");
    expect(changeSet.files[0]?.status).toBe("modified");
    expect(event.type).toBe("task.started");
    expect(assistantDelta.channel).toBe("thinking");
    expect(selected.type).toBe("subagent.selected");
  });
});
