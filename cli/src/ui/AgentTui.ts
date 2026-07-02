import { defineComponent, h, onBeforeUnmount, ref } from "vue";
import { Box, Text, useApp, useInput } from "@vue-tui/runtime";
import type { AgentConfig, AgentSession } from "@coding-agent/core";
import { EventStreamRenderer } from "./EventStreamRenderer.js";

export type AgentTuiProps = {
  config: AgentConfig;
  createSession?: (config: AgentConfig) => AgentSession;
  saveConfig?: (config: AgentConfig) => Promise<void>;
};

const providerOptions = ["deepseek", "openai", "anthropic", "gemini", "mistral"] as const;
const modelOptions: Record<string, string[]> = {
  deepseek: ["deepseek-reasoner", "deepseek-chat"],
  openai: ["gpt-5.5", "gpt-5"],
  anthropic: ["claude-opus-4-5", "claude-sonnet-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  mistral: ["mistral-large-latest", "codestral-latest"]
};

export const AgentTui = defineComponent<AgentTuiProps>(
  (props) => {
    const app = useApp();
    const config = ref<AgentConfig>({ ...props.config });
    const session = ref<AgentSession>();
    const busy = ref(false);
    const draft = ref("");
    const mode = ref<"chat" | "model-provider" | "model-model" | "model-key">("chat");
    const selectedProvider = ref(0);
    const selectedModel = ref(0);
    const pendingApiKey = ref("");
    const lines = ref<string[]>([
      `workspace: ${config.value.workspacePath ?? process.cwd()}`,
      `model: ${formatModel(config.value)}`,
      "快捷键：Ctrl+M 配置模型，Ctrl+W 查看工作区，Ctrl+C 退出。"
    ]);

    onBeforeUnmount(() => {
      void session.value?.stop();
    });

    useInput((input, key) => {
      if (key.ctrl && input === "c") {
        void session.value?.stop();
        app.exit();
        return;
      }

      if (key.ctrl && input === "w") {
        appendLine(`workspace: ${config.value.workspacePath ?? process.cwd()}`);
        return;
      }

      if ((key.ctrl && input === "m") || (mode.value === "chat" && draft.value === "/model" && key.return)) {
        enterModelProviderMode();
        return;
      }

      if (mode.value !== "chat") {
        handleModelInput(input, key);
        return;
      }

      if (key.return) {
        const prompt = draft.value.trim();
        draft.value = "";
        void handlePrompt(prompt);
        return;
      }

      if (key.backspace || key.delete) {
        draft.value = draft.value.slice(0, -1);
        return;
      }

      if (input) {
        draft.value += input;
      }
    });

    function enterModelProviderMode(): void {
      mode.value = "model-provider";
      const currentIndex = providerOptions.findIndex((provider) => provider === config.value.provider);
      selectedProvider.value = currentIndex >= 0 ? currentIndex : 0;
      const models = modelOptions[providerOptions[selectedProvider.value]];
      const modelIndex = models.findIndex((model) => model === config.value.model);
      selectedModel.value = modelIndex >= 0 ? modelIndex : 0;
      pendingApiKey.value = config.value.apiKey ?? "";
      appendLine("模型配置：选择 provider，↑/↓ 切换，Enter 确认，Esc 取消。");
    }

    function handleModelInput(input: string, key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean; backspace: boolean; delete: boolean }): void {
      if (key.escape) {
        mode.value = "chat";
        appendLine("已取消模型配置。");
        return;
      }

      if (mode.value === "model-provider") {
        if (key.upArrow) {
          selectedProvider.value = wrap(selectedProvider.value - 1, providerOptions.length);
          return;
        }
        if (key.downArrow) {
          selectedProvider.value = wrap(selectedProvider.value + 1, providerOptions.length);
          return;
        }
        if (key.return) {
          mode.value = "model-model";
          selectedModel.value = 0;
          appendLine("模型配置：选择 model，↑/↓ 切换，Enter 确认。");
        }
        return;
      }

      if (mode.value === "model-model") {
        const models = modelOptions[providerOptions[selectedProvider.value]];
        if (key.upArrow) {
          selectedModel.value = wrap(selectedModel.value - 1, models.length);
          return;
        }
        if (key.downArrow) {
          selectedModel.value = wrap(selectedModel.value + 1, models.length);
          return;
        }
        if (key.return) {
          mode.value = "model-key";
          appendLine("模型配置：输入 API Key，Enter 保存；留空则继续使用环境变量。");
        }
        return;
      }

      if (mode.value === "model-key") {
        if (key.backspace || key.delete) {
          pendingApiKey.value = pendingApiKey.value.slice(0, -1);
          return;
        }
        if (key.return) {
          void saveModelConfig();
          return;
        }
        if (input) {
          pendingApiKey.value += input;
        }
      }
    }

    async function saveModelConfig(): Promise<void> {
      const provider = providerOptions[selectedProvider.value];
      const model = modelOptions[provider][selectedModel.value];
      const nextConfig: AgentConfig = {
        ...config.value,
        provider,
        model,
        apiKey: pendingApiKey.value || undefined
      };
      config.value = nextConfig;
      mode.value = "chat";
      if (session.value) {
        await session.value.stop();
        session.value = undefined;
      }
      await props.saveConfig?.(nextConfig);
      appendLine(`model: ${formatModel(nextConfig)}`);
    }

    async function handlePrompt(prompt: string): Promise<void> {
      if (!prompt) {
        return;
      }

      if (prompt === "/exit" || prompt === "/quit") {
        await session.value?.stop();
        app.exit();
        return;
      }

      if (prompt === "/workspace") {
        appendLine(`workspace: ${config.value.workspacePath ?? process.cwd()}`);
        return;
      }

      if (prompt === "/model") {
        enterModelProviderMode();
        return;
      }

      await sendPrompt(prompt);
    }

    async function sendPrompt(prompt: string): Promise<void> {
      if (busy.value) {
        appendLine("当前还有任务在运行，请等待完成。");
        return;
      }

      busy.value = true;
      appendLine(`你：${prompt}`);

      try {
        const activeSession = session.value ?? props.createSession?.(config.value);
        if (!activeSession) {
          appendLine("Agent 会话创建失败：缺少 core session factory。");
          return;
        }

        if (!session.value) {
          await activeSession.start();
          session.value = activeSession;
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
        busy.value = false;
      }
    }

    function appendLine(line: string): void {
      lines.value = [...lines.value, line];
    }

    function appendLines(nextLines: string[]): void {
      lines.value = [...lines.value, ...nextLines.filter((line) => line.length > 0)];
    }

    return () =>
      h(Box, { flexDirection: "column" }, () => [
        h(Box, { borderStyle: "single", paddingX: 1 }, () => [
          h(Text, null, () => `Agent | ${config.value.workspacePath ?? process.cwd()} | ${formatModel(config.value)}`)
        ]),
        h(Box, { flexDirection: "column", marginTop: 1 }, () => [
          ...lines.value.slice(-18).map((line) => h(Text, null, () => line)),
          ...renderModelPicker(mode.value, selectedProvider.value, selectedModel.value, pendingApiKey.value)
        ]),
        h(Box, { marginTop: 1 }, () => [
          h(Text, null, () => `${busy.value ? "…" : ">"} ${mode.value === "chat" ? draft.value : modelPrompt(mode.value)}`)
        ])
      ]);
  },
  {
    props: ["config", "createSession", "saveConfig"]
  }
);

function renderModelPicker(mode: string, selectedProvider: number, selectedModel: number, pendingApiKey: string) {
  if (mode === "chat") {
    return [];
  }

  const provider = providerOptions[selectedProvider];
  const models = modelOptions[provider];
  if (mode === "model-provider") {
    return providerOptions.map((option, index) => h(Text, { color: index === selectedProvider ? "green" : undefined }, () => `${index === selectedProvider ? ">" : " "} ${option}`));
  }

  if (mode === "model-model") {
    return models.map((option, index) => h(Text, { color: index === selectedModel ? "green" : undefined }, () => `${index === selectedModel ? ">" : " "} ${option}`));
  }

  return [h(Text, { dimColor: true }, () => `API Key: ${pendingApiKey ? "*".repeat(Math.min(pendingApiKey.length, 12)) : "(使用环境变量)"}`)];
}

function modelPrompt(mode: string): string {
  if (mode === "model-provider") {
    return "选择 provider";
  }
  if (mode === "model-model") {
    return "选择 model";
  }
  return "输入 API Key";
}

function formatModel(config: AgentConfig): string {
  return `${config.provider ?? "未配置"}/${config.model ?? "未配置"}`;
}

function wrap(value: number, length: number): number {
  return (value + length) % length;
}
