import type { AgentPermissionPolicy } from "../config/AgentConfig.js";
import { resolveAgentPermissionPolicy } from "../config/AgentConfig.js";

export type ToolRequest = {
  tool: string;
  summary: string;
};

export type ToolDecision = { decision: "allow" } | { decision: "confirm" } | { decision: "deny"; reason: string };

export type ToolAuthorization = { authorized: true } | { authorized: false; reason: string };

export type ToolBoundaryDependencies = {
  approve?: (request: ToolRequest) => Promise<boolean>;
};

export class ToolBoundary {
  private readonly policy: Required<AgentPermissionPolicy>;

  constructor(
    policy: AgentPermissionPolicy,
    private readonly dependencies: ToolBoundaryDependencies = {}
  ) {
    this.policy = resolveAgentPermissionPolicy({ permissionPolicy: policy });
  }

  async decide(request: ToolRequest): Promise<ToolDecision> {
    if (this.policy.deny.includes(request.tool)) {
      return { decision: "deny", reason: `policy denies ${request.tool}` };
    }

    if (this.policy.mode === "readonly" && !this.policy.allow.includes(request.tool)) {
      return { decision: "deny", reason: `readonly mode blocks ${request.tool}` };
    }

    if (this.policy.mode === "bypass") {
      return { decision: "allow" };
    }

    if (this.policy.allow.includes(request.tool)) {
      return { decision: "allow" };
    }

    if (this.policy.confirm.includes(request.tool)) {
      return { decision: "confirm" };
    }

    return { decision: "confirm" };
  }

  async authorize(request: ToolRequest): Promise<ToolAuthorization> {
    const decision = await this.decide(request);
    if (decision.decision === "allow") {
      return { authorized: true };
    }
    if (decision.decision === "deny") {
      return { authorized: false, reason: decision.reason };
    }

    const approved = await this.dependencies.approve?.(request);
    return approved ? { authorized: true } : { authorized: false, reason: `approval rejected ${request.tool}` };
  }
}
