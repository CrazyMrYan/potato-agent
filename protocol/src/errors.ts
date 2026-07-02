export type AgentErrorCode =
  | "WORKSPACE_NOT_FOUND"
  | "NOT_GIT_REPOSITORY"
  | "PI_INIT_FAILED"
  | "TOOL_FAILED"
  | "APPROVAL_REJECTED"
  | "COMMAND_FAILED"
  | "TASK_CANCELLED"
  | "UNKNOWN_ERROR";

export type AgentError = {
  code: AgentErrorCode;
  message: string;
  cause?: string;
};
