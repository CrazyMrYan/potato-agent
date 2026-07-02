import type { AgentEvent, RunTaskInput } from "@coding-agent/protocol";
import type { PiAdapter } from "./PiAdapter.js";

export class FakePiAdapter implements PiAdapter {
  async *run(input: RunTaskInput): AsyncIterable<AgentEvent> {
    yield { type: "step.started", taskId: input.taskId, title: "创建任务上下文" };
    yield { type: "tool.started", taskId: input.taskId, tool: "git.status", summary: "读取 Git 状态" };
    yield { type: "tool.finished", taskId: input.taskId, tool: "git.status", success: true, output: "工作区干净" };
    yield { type: "diff.produced", taskId: input.taskId, changeSet: { files: [] } };
    yield { type: "task.finished", taskId: input.taskId, summary: "模拟任务完成，尚未接入真实 Pi" };
  }
}
