#!/usr/bin/env node
import { Command } from "commander";
import { chatCommand } from "./commands/chat.js";
import { diffCommand } from "./commands/diff.js";
import { RenderedTaskFailedError, runCommand } from "./commands/run.js";
import { traceCommand } from "./commands/trace.js";
import { runTuiCommand } from "./commands/tui.js";
import { formatCliError } from "./cliError.js";

const program = new Command();

program
  .name("potato")
  .description("Potato CLI")
  .version("0.1.0")
  .action(async () => {
    try {
      await runTuiCommand({
        cwd: process.cwd()
      });
    } catch (error) {
      console.error(formatCliError(error));
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .argument("<prompt>", "任务描述")
  .option("--provider <provider>", "模型供应商，例如 openai、anthropic")
  .option("--model <model>", "模型名称，例如 gpt-5.5、claude-opus-4-5")
  .option("--api-key <apiKey>", "模型 API Key，也可使用对应环境变量")
  .option("--workspace <path>", "要验证的项目目录")
  .option("--timeout-ms <ms>", "Pi RPC 等待超时时间", "120000")
  .action(async (prompt: string, options: Record<string, string>) => {
    try {
      await runCommand(prompt, {
        provider: options.provider,
        model: options.model,
        apiKey: options.apiKey,
        workspacePath: options.workspace,
        cwd: process.cwd(),
        timeoutMs: Number(options.timeoutMs)
      });
    } catch (error) {
      if (!(error instanceof RenderedTaskFailedError)) {
        console.error(formatCliError(error));
      }
      process.exitCode = 1;
    }
  });

program
  .command("chat")
  .description("进入多轮交互会话")
  .option("--provider <provider>", "模型供应商，例如 deepseek")
  .option("--model <model>", "模型名称，例如 deepseek-reasoner")
  .option("--api-key <apiKey>", "模型 API Key，也可使用对应环境变量")
  .option("--workspace <path>", "要验证的项目目录")
  .option("--timeout-ms <ms>", "Pi RPC 每轮等待超时时间", "120000")
  .action(async (options: Record<string, string>) => {
    try {
      await chatCommand({
        provider: options.provider,
        model: options.model,
        apiKey: options.apiKey,
        workspacePath: options.workspace,
        cwd: process.cwd(),
        timeoutMs: Number(options.timeoutMs)
      });
    } catch (error) {
      console.error(formatCliError(error));
      process.exitCode = 1;
    }
  });

program
  .command("diff")
  .description("显示当前工作区的 Git diff")
  .option("--workspace <path>", "要查看的项目目录")
  .option("--no-patch", "只显示文件列表，不显示 patch")
  .action(async (options: { workspace: string; patch: boolean }) => {
    try {
      await diffCommand({ workspacePath: options.workspace, patch: options.patch, cwd: process.cwd() });
    } catch (error) {
      console.error(formatCliError(error));
      process.exitCode = 1;
    }
  });

program
  .command("trace")
  .description("查看任务 trace")
  .argument("[taskId]", "任务 ID")
  .option("--workspace <path>", "要查看的项目目录")
  .option("--raw", "输出原始 JSONL 条目")
  .action(async (taskId: string | undefined, options: { workspace: string; raw?: boolean }) => {
    try {
      await traceCommand({ workspacePath: options.workspace, taskId, raw: options.raw, cwd: process.cwd() });
    } catch (error) {
      console.error(formatCliError(error));
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
