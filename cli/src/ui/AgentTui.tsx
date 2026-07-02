import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { AgentConfig, AgentSession } from "@coding-agent/core";
import { EventStreamRenderer } from "./EventStreamRenderer.js";

export type AgentTuiProps = {
  config: AgentConfig;
  createSession?: (config: AgentConfig) => AgentSession;
  saveConfig?: (config: AgentConfig) => Promise<void>;
};

export function AgentTui({ config: initialConfig, createSession, saveConfig }: AgentTuiProps): React.ReactElement {
  const { exit } = useApp();
  const [config, setConfig] = useState<AgentConfig>(initialConfig);
  const [session, setSession] = useState<AgentSession>();
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([
    `workspace: ${initialConfig.workspacePath ?? process.cwd()}`,
    `model: ${formatModel(initialConfig)}`,
    "输入 /exit 退出，/workspace 查看工作区，/model <provider> <model> [apiKey] 配置模型。"
  ]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    return () => {
      void session?.stop();
    };
  }, [session]);

  useInput((input, key) => {
    if (key.return) {
      const prompt = draft.trim();
      setDraft("");
      handlePrompt(prompt);
      return;
    }

    if (key.backspace || key.delete) {
      setDraft((current) => current.slice(0, -1));
      return;
    }

    if (input) {
      setDraft((current) => `${current}${input}`);
    }
  });

  function handlePrompt(prompt: string): void {
    if (!prompt) {
      return;
    }

    if (prompt === "/exit" || prompt === "/quit") {
      void session?.stop();
      exit();
      return;
    }

    if (prompt === "/workspace") {
      appendLine(`workspace: ${config.workspacePath ?? process.cwd()}`);
      return;
    }

    if (prompt === "/model") {
      appendLine(`model: ${formatModel(config)}`);
      return;
    }

    if (prompt.startsWith("/model ")) {
      const [, provider, model, apiKey] = prompt.split(/\s+/);
      if (!provider || !model) {
        appendLine("用法：/model <provider> <model> [apiKey]");
        return;
      }

      const nextConfig = { ...config, provider, model, apiKey: apiKey ?? config.apiKey };
      setConfig(nextConfig);
      void saveConfig?.(nextConfig);
      if (session) {
        void session.stop();
        setSession(undefined);
      }
      appendLine(`model: ${formatModel(nextConfig)}`);
      return;
    }

    void sendPrompt(prompt);
  }

  async function sendPrompt(prompt: string): Promise<void> {
    if (busy) {
      appendLine("当前还有任务在运行，请等待完成。");
      return;
    }

    setBusy(true);
    appendLine(`你：${prompt}`);

    try {
      const activeSession = session ?? createSession?.(config);
      if (!activeSession) {
        appendLine("Agent 会话创建失败：缺少 core session factory。");
        return;
      }

      if (!session) {
        await activeSession.start();
        setSession(activeSession);
      }

      const renderer = new EventStreamRenderer({ colors: false });
      for await (const event of activeSession.send(prompt)) {
        const rendered = renderer.render(event);
        if (rendered) {
          appendLines(rendered.split("\n"));
        }
      }

      const remaining = renderer.flush();
      if (remaining) {
        appendLines(remaining.split("\n"));
      }
    } catch (error) {
      appendLine(`Agent 会话失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  function appendLine(line: string): void {
    setLines((current) => [...current, line]);
  }

  function appendLines(nextLines: string[]): void {
    setLines((current) => [...current, ...nextLines.filter((line) => line.length > 0)]);
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" paddingX={1}>
        <Text>
          Agent | {config.workspacePath ?? process.cwd()} | {formatModel(config)}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {lines.slice(-20).map((line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text>{`${busy ? "…" : ">"} ${draft}`}</Text>
      </Box>
    </Box>
  );
}

function formatModel(config: AgentConfig): string {
  return `${config.provider ?? "未配置"}/${config.model ?? "未配置"}`;
}
