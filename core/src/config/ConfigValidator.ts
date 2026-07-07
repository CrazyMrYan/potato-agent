import { access } from "node:fs/promises";
import type { AgentConfig } from "./AgentConfig.js";
import { resolvePiAdapterOptions } from "../pi/resolvePiAdapterOptions.js";

export type ConfigIssue = {
  severity: "error" | "warning";
  code: "MISSING_PROVIDER" | "MISSING_MODEL" | "MISSING_API_KEY" | "WORKSPACE_NOT_FOUND" | "UNKNOWN_PERMISSION_MODE";
  message: string;
};

export type ConfigValidationResult = {
  ok: boolean;
  issues: ConfigIssue[];
};

export type ConfigValidatorDependencies = {
  exists?: (path: string) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
};

export class ConfigValidator {
  constructor(private readonly dependencies: ConfigValidatorDependencies = {}) {}

  async validate(config: AgentConfig): Promise<ConfigValidationResult> {
    const issues: ConfigIssue[] = [];
    if (!config.provider) issues.push({ severity: "error", code: "MISSING_PROVIDER", message: "Missing provider." });
    if (!config.model) issues.push({ severity: "error", code: "MISSING_MODEL", message: "Missing model." });
    if (config.provider && config.model) {
      try {
        resolvePiAdapterOptions({ ...config, env: this.dependencies.env ?? process.env });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/API_KEY|api key|--api-key/i.test(message)) {
          issues.push({ severity: "error", code: "MISSING_API_KEY", message });
        } else {
          issues.push({ severity: "error", code: "MISSING_PROVIDER", message });
        }
      }
    }
    const workspacePath = config.workspacePath ?? process.cwd();
    if (!(await this.exists(workspacePath))) {
      issues.push({ severity: "error", code: "WORKSPACE_NOT_FOUND", message: `Workspace does not exist: ${workspacePath}` });
    }
    const mode = config.permissionPolicy?.mode;
    if (mode && !["confirm", "bypass", "readonly"].includes(mode)) {
      issues.push({ severity: "error", code: "UNKNOWN_PERMISSION_MODE", message: `Unknown permission mode: ${mode}` });
    }
    return { ok: !issues.some((issue) => issue.severity === "error"), issues };
  }

  private async exists(path: string): Promise<boolean> {
    if (this.dependencies.exists) return this.dependencies.exists(path);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
