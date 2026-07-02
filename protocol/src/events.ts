import type { ApprovalRequest } from "./approval.js";
import type { ChangeSet } from "./changeset.js";
import type { AgentError } from "./errors.js";

export type TaskStartedEvent = {
  type: "task.started";
  taskId: string;
  workspacePath: string;
  prompt: string;
};

export type StepStartedEvent = {
  type: "step.started";
  taskId: string;
  title: string;
};

export type ToolCallStartedEvent = {
  type: "tool.started";
  taskId: string;
  tool: string;
  summary: string;
};

export type ToolCallFinishedEvent = {
  type: "tool.finished";
  taskId: string;
  tool: string;
  success: boolean;
  output?: string;
};

export type AssistantMessageDeltaEvent = {
  type: "assistant.delta";
  taskId: string;
  channel: "text" | "thinking";
  text: string;
};

export type ApprovalRequestedEvent = {
  type: "approval.requested";
  taskId: string;
  request: ApprovalRequest;
};

export type DiffProducedEvent = {
  type: "diff.produced";
  taskId: string;
  changeSet: ChangeSet;
};

export type VerificationStartedEvent = {
  type: "verification.started";
  taskId: string;
  command: string;
};

export type VerificationFinishedEvent = {
  type: "verification.finished";
  taskId: string;
  command: string;
  exitCode: number;
  output: string;
};

export type TaskFinishedEvent = {
  type: "task.finished";
  taskId: string;
  summary: string;
};

export type TaskFailedEvent = {
  type: "task.failed";
  taskId: string;
  error: AgentError;
};

export type AgentEvent =
  | TaskStartedEvent
  | StepStartedEvent
  | ToolCallStartedEvent
  | ToolCallFinishedEvent
  | AssistantMessageDeltaEvent
  | ApprovalRequestedEvent
  | DiffProducedEvent
  | VerificationStartedEvent
  | VerificationFinishedEvent
  | TaskFinishedEvent
  | TaskFailedEvent;
