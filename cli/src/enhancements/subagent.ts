import { RpcClient, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { PotatoSubagentConfig } from "./types.js";

export type RunSubagentInput = {
  agent: PotatoSubagentConfig;
  task: string;
  cwd: string;
};

export type SubagentOptions = {
  subagents: PotatoSubagentConfig[];
  runSubagent?: (input: RunSubagentInput) => Promise<string>;
};

export function createSubagentExtension(options: SubagentOptions): ExtensionFactory {
  return (pi) => {
    const subagents = options.subagents.filter((agent) => agent.id && agent.systemPrompt);
    if (subagents.length === 0) return;

    pi.registerTool({
      name: "potato_subagent",
      label: "Run Potato subagent",
      description: "Run a configured Potato subagent in an isolated Pi RPC session.",
      parameters: Type.Object({
        agent: Type.String(),
        task: Type.String()
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const agent = subagents.find((candidate) => candidate.id === params.agent);
        if (!agent) {
          return {
            content: [{ type: "text", text: `Unknown subagent: ${params.agent}` }],
            details: { agent: params.agent },
            isError: true
          };
        }
        const text = await (options.runSubagent ?? runPiSubagent)({ agent, task: params.task, cwd: ctx.cwd });
        return { content: [{ type: "text", text }], details: { agent: agent.id } };
      }
    });
  };
}

async function runPiSubagent(input: RunSubagentInput): Promise<string> {
  const client = new RpcClient({
    cwd: input.cwd,
    args: ["--no-session", "--append-system-prompt", input.agent.systemPrompt, ...(input.agent.tools ? ["--tools", input.agent.tools.join(",")] : [])]
  });
  await client.start();
  try {
    await client.prompt(input.task);
    await client.waitForIdle();
    return (await client.getLastAssistantText()) ?? "";
  } finally {
    await client.stop();
  }
}
