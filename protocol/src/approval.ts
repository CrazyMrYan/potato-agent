export type ApprovalKind = "write_file" | "run_command" | "delete_file";
export type ApprovalRisk = "low" | "medium" | "high";

export type ApprovalRequest = {
  id: string;
  taskId: string;
  kind: ApprovalKind;
  title: string;
  detail: string;
  risk: ApprovalRisk;
};

export type ApprovalDecision =
  | { type: "allow" }
  | { type: "request_approval"; request: ApprovalRequest }
  | { type: "deny"; reason: string };
