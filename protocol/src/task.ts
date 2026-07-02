export type TaskMode = "run";
export type ApprovalMode = "manual" | "auto-readonly";

export type RunTaskInput = {
  taskId: string;
  workspacePath: string;
  prompt: string;
  mode: TaskMode;
  approvalMode: ApprovalMode;
};
