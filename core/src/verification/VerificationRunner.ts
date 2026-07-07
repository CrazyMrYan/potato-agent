import { execFile as nodeExecFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentEvent } from "@potato/protocol";
import type { AgentVerificationConfig } from "../config/AgentConfig.js";

const execFileAsync = promisify(nodeExecFile);

export type VerificationResult = {
  command: string;
  exitCode: number;
  output: string;
};

export type VerificationRunnerDependencies = {
  execFile?: (file: string, args: string[], options: { cwd: string; timeout?: number }) => Promise<{ exitCode: number; output: string }>;
};

export class VerificationRunner {
  constructor(private readonly dependencies: VerificationRunnerDependencies = {}) {}

  async detect(workspacePath: string): Promise<string | undefined> {
    try {
      const pkg = JSON.parse(await readFile(join(workspacePath, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test) return "pnpm test";
      if (pkg.scripts?.check) return "pnpm check";
      if (pkg.scripts?.build) return "pnpm build";
      return undefined;
    } catch {
      return undefined;
    }
  }

  async run(input: { workspacePath: string; command: string; timeoutMs?: number }): Promise<VerificationResult> {
    const [file, ...args] = splitCommand(input.command);
    const execFile = this.dependencies.execFile ?? defaultExecFile;
    return { command: input.command, ...(await execFile(file, args, { cwd: input.workspacePath, timeout: input.timeoutMs })) };
  }
}

export async function* runVerificationEvents(input: {
  taskId: string;
  workspacePath: string;
  config?: AgentVerificationConfig;
  runner?: Pick<VerificationRunner, "detect" | "run">;
}): AsyncIterable<AgentEvent> {
  const verification = input.config;
  const runner = input.runner;
  if (verification?.enabled === false || !runner) return;

  const command = verification?.command ?? (verification?.autoDetect === false ? undefined : await runner.detect(input.workspacePath));
  if (!command) return;

  yield { type: "verification.started", taskId: input.taskId, command };
  const result = await runner.run({ workspacePath: input.workspacePath, command, timeoutMs: verification?.timeoutMs });
  yield {
    type: "verification.finished",
    taskId: input.taskId,
    command: result.command,
    exitCode: result.exitCode,
    output: result.output
  };
}

function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

async function defaultExecFile(file: string, args: string[], options: { cwd: string; timeout?: number }): Promise<{ exitCode: number; output: string }> {
  try {
    const result = await execFileAsync(file, args, { cwd: options.cwd, timeout: options.timeout, encoding: "utf8" });
    return { exitCode: 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? failure.message ?? ""}`
    };
  }
}
