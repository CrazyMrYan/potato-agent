import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../src/orchestrator/AgentOrchestrator.js";
import { FakePiAdapter } from "../src/pi/FakePiAdapter.js";

describe("AgentOrchestrator", () => {
  it("emits task started and fake adapter events", async () => {
    const orchestrator = new AgentOrchestrator(new FakePiAdapter());
    const events = [];

    for await (const event of orchestrator.run({
      taskId: "task_1",
      workspacePath: "/repo",
      prompt: "测试任务",
      mode: "run",
      approvalMode: "manual"
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "step.started",
      "tool.started",
      "tool.finished",
      "diff.produced",
      "task.finished"
    ]);
  });
});
