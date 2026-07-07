import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentMcpServerConfig } from "../config/AgentConfig.js";

const execFileAsync = promisify(execFile);

export type McpCheckStatus = "ok" | "missing-command" | "missing-env" | "startup-failed";

export type McpCheckResult = {
  name: string;
  status: McpCheckStatus;
  message: string;
};

export type McpConfigCheckerDependencies = {
  adapter?: "rpc" | "runtime" | "sdk";
  env?: NodeJS.ProcessEnv;
  commandExists?: (command: string) => Promise<boolean>;
  start?: (server: { command: string; args?: string[]; env?: Record<string, string> }) => Promise<{ ok: true } | { ok: false; message: string }>;
};

export class McpConfigChecker {
  constructor(private readonly dependencies: McpConfigCheckerDependencies = {}) {}

  async check(server: AgentMcpServerConfig): Promise<McpCheckResult> {
    const commandExists = await (this.dependencies.commandExists ?? defaultCommandExists)(server.command);
    if (!commandExists) {
      return {
        name: server.name,
        status: "missing-command",
        message: `Command not found: ${server.command}`
      };
    }

    const env = resolveServerEnv(server.env, this.dependencies.env ?? process.env);
    const missingEnv = Object.entries(server.env ?? [])
      .filter(([, envName]) => !env?.[envName])
      .map(([name]) => name);
    if (missingEnv.length > 0) {
      return {
        name: server.name,
        status: "missing-env",
        message: `Missing environment variables: ${missingEnv.join(", ")}`
      };
    }

    const startup = await this.dependencies.start?.({ command: server.command, args: server.args, env });
    if (startup?.ok === false) {
      return {
        name: server.name,
        status: "startup-failed",
        message: startup.message
      };
    }

    return {
      name: server.name,
      status: "ok",
      message: "MCP server configuration is valid."
    };
  }
}

function resolveServerEnv(config: Record<string, string> | undefined, env: NodeJS.ProcessEnv): Record<string, string> | undefined {
  if (!config) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(config).map(([name, envName]) => [name, env[envName] ?? ""]));
}

async function defaultCommandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-lc", `command -v ${JSON.stringify(command)}`]);
    return true;
  } catch {
    return false;
  }
}
