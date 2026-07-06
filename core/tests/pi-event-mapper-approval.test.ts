import { describe, expect, it } from "vitest";
import { PiEventMapper } from "../src/pi/PiEventMapper.js";

describe("PiEventMapper approval events", () => {
  it("maps RPC confirm extension UI requests into approval requests", () => {
    const mapper = new PiEventMapper("task_1");

    expect(
      mapper.map({
        type: "extension_ui_request",
        id: "approval_1",
        method: "confirm",
        title: "Approve bash?",
        message: "{\"command\":\"touch file.txt\"}"
      })
    ).toEqual([
      {
        type: "approval.requested",
        taskId: "task_1",
        request: {
          id: "approval_1",
          taskId: "task_1",
          kind: "run_command",
          title: "Approve bash?",
          detail: "{\"command\":\"touch file.txt\"}",
          risk: "medium"
        }
      }
    ]);
  });
});
