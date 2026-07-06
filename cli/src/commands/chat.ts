import { input } from "@inquirer/prompts";
import { AgentSessionFactory, resolveDefaultWorkspacePath, type AgentConfig, type AgentSession } from "@potato/core";
import { EventStreamRenderer } from "../ui/EventStreamRenderer.js";

export type ChatCommandOptions = AgentConfig & {
  cwd?: string;
  createSession?: (options: AgentConfig) => AgentSession;
  resolveWorkspacePath?: (cwd: string) => Promise<string>;
  read?: () => Promise<string>;
  write?: (line: string) => void;
};

export async function chatCommand(options: ChatCommandOptions = {}): Promise<void> {
  const workspacePath = options.workspacePath ?? (await (options.resolveWorkspacePath ?? resolveDefaultWorkspacePath)(options.cwd ?? process.cwd()));
  const session = options.createSession
    ? options.createSession({ ...options, workspacePath })
    : await new AgentSessionFactory().create({ ...options, workspacePath });
  const read = options.read ?? (() => input({ message: "你" }));
  const write = options.write ?? console.log;

  write(`进入交互会话：${options.provider ?? "未配置"}/${options.model ?? "未配置"}`);
  write("输入 /exit 退出。");

  await session.start();
  try {
    while (true) {
      const prompt = (await read()).trim();

      if (!prompt) {
        continue;
      }

      if (prompt === "/exit" || prompt === "/quit") {
        write("已退出交互会话。");
        break;
      }

      const renderer = new EventStreamRenderer();
      for await (const event of session.send(prompt)) {
        const rendered = renderer.render(event);
        if (rendered) {
          write(rendered);
        }

        if (event.type === "task.failed") {
          break;
        }
      }

      const remaining = renderer.flush();
      if (remaining) {
        write(remaining);
      }
    }
  } finally {
    await session.stop();
  }
}
