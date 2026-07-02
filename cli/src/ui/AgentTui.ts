import { defineComponent, h, markRaw, onBeforeUnmount, ref, shallowRef } from "vue";
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
    const session = shallowRef<AgentSession>();
    const busy = ref(false);
    const draft = ref("");
    const scrollOffset = ref(0);
    const mode = ref<"chat" | "command" | "model-provider" | "model-model" | "model-key">("chat");
    const selectedCommand = ref(0);
    const selectedProvider = ref(0);
    const selectedModel = ref(0);
    const pendingApiKey = ref("");
    const lines = ref<string[]>([
      "准备就绪。输入任务开始，输入 / 打开命令菜单。"
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

      if (mode.value === "chat" && key.pageUp) {
        scrollOffset.value = Math.min(scrollOffset.value + 8, Math.max(lines.value.length - visibleEventLines, 0));
        return;
      }

      if (mode.value === "chat" && key.pageDown) {
        scrollOffset.value = Math.max(scrollOffset.value - 8, 0);
        return;
      }

      if (mode.value === "chat" && key.upArrow && draft.value.length === 0) {
        scrollOffset.value = Math.min(scrollOffset.value + 1, Math.max(lines.value.length - visibleEventLines, 0));
        return;
      }

      if (mode.value === "chat" && key.downArrow && draft.value.length === 0) {
        scrollOffset.value = Math.max(scrollOffset.value - 1, 0);
        return;
      }

      if ((key.ctrl && input === "m") || (mode.value === "chat" && draft.value === "/model" && key.return)) {
        draft.value = "";
        enterModelProviderMode();
        return;
      }

      if (mode.value === "command") {
        handleCommandInput(key);
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
        if (!draft.value.startsWith("/")) {
          mode.value = "chat";
        }
        return;
      }

      if (input) {
        draft.value += input;
        if (draft.value.startsWith("/")) {
          mode.value = "command";
          selectedCommand.value = 0;
        }
      }
    });

    function handleCommandInput(key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean; backspace: boolean; delete: boolean }): void {
      if (key.escape) {
        draft.value = "";
        mode.value = "chat";
        return;
      }

      if (key.upArrow) {
        selectedCommand.value = wrap(selectedCommand.value - 1, commandOptions.length);
        return;
      }

      if (key.downArrow) {
        selectedCommand.value = wrap(selectedCommand.value + 1, commandOptions.length);
        return;
      }

      if (key.backspace || key.delete) {
        draft.value = draft.value.slice(0, -1);
        if (!draft.value.startsWith("/")) {
          mode.value = "chat";
        }
        return;
      }

      if (key.return) {
        const command = commandOptions[selectedCommand.value].command;
        draft.value = "";
        mode.value = "chat";
        void handlePrompt(command);
      }
    }

    function enterModelProviderMode(): void {
      mode.value = "model-provider";
      const currentIndex = providerOptions.findIndex((provider) => provider === config.value.provider);
      selectedProvider.value = currentIndex >= 0 ? currentIndex : 0;
      const models = modelOptions[providerOptions[selectedProvider.value]];
      const modelIndex = models.findIndex((model) => model === config.value.model);
      selectedModel.value = modelIndex >= 0 ? modelIndex : 0;
      pendingApiKey.value = config.value.apiKey ?? "";
      appendLine("打开模型配置。");
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
      appendLine(`模型已配置：${formatModel(nextConfig)}`);
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
        const createdSession = props.createSession?.(config.value);
        const activeSession = session.value ?? (createdSession ? markRaw(createdSession) : undefined);
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
      scrollOffset.value = 0;
    }

    function appendLines(nextLines: string[]): void {
      lines.value = [...lines.value, ...nextLines.filter((line) => line.length > 0)];
      scrollOffset.value = 0;
    }

    function visibleLines(): string[] {
      const end = Math.max(lines.value.length - scrollOffset.value, 0);
      const start = Math.max(end - visibleEventLines, 0);
      return lines.value.slice(start, end);
    }

    function renderVisibleEvents() {
      const visible = visibleLines();
      const scrollbar = buildScrollbar(lines.value.length, scrollOffset.value, visibleEventLines, visible.length);
      return visible.map((line, index) =>
        h(Box, { justifyContent: "space-between" }, () => [
          h(Text, eventTextStyle(line), () => line),
          h(Text, { color: scrollbar[index] === "█" ? "cyan" : "gray", dimColor: scrollbar[index] !== "█" }, () => scrollbar[index] ?? " ")
        ])
      );
    }

    return () =>
      h(Box, { flexDirection: "column", paddingX: 1 }, () => [
        h(Box, { justifyContent: "space-between" }, () => [
          h(Text, { bold: true, color: "cyan" }, () => "Coding Agent"),
          h(Text, { dimColor: true }, () => `${busy.value ? "运行中" : "空闲"} · ${formatModel(config.value)}`)
        ]),
        h(Box, { marginTop: 1, paddingX: 1, flexDirection: "column" }, () => [
          h(Text, { dimColor: true }, () => "WORKSPACE"),
          h(Text, null, () => config.value.workspacePath ?? process.cwd())
        ]),
        h(Box, { marginTop: 1, paddingX: 1, flexDirection: "column", minHeight: 10 }, () => [
          h(Text, { dimColor: true }, () => `EVENTS${lines.value.length > visibleEventLines ? ` · ${Math.max(lines.value.length - visibleEventLines - scrollOffset.value + 1, 1)}-${Math.max(lines.value.length - scrollOffset.value, 1)}/${lines.value.length}` : ""}`),
          ...renderVisibleEvents(),
          ...renderCommandMenu(mode.value, selectedCommand.value),
          ...renderModelPicker(mode.value, selectedProvider.value, selectedModel.value, pendingApiKey.value)
        ]),
        h(Box, { marginTop: 1, paddingX: 1 }, () => [
          h(Text, null, () => `${inputLabel(mode.value)} ${mode.value === "chat" || mode.value === "command" ? draft.value : modelPrompt(mode.value)}`)
        ]),
        h(Box, { marginTop: 1 }, () => [
          h(Text, { dimColor: true }, () => "Ctrl+M 模型 · 输入 / 打开命令 · PageUp/PageDown 滚动 · Ctrl+C 退出")
        ])
      ]);
  },
  {
    props: ["config", "createSession", "saveConfig"]
  }
);

const commandOptions = [
  { command: "/model", label: "/model", description: "配置 provider、model 和 API Key" },
  { command: "/workspace", label: "/workspace", description: "显示当前工作区" },
  { command: "/exit", label: "/exit", description: "退出 TUI" }
];

const visibleEventLines = 14;

function buildScrollbar(totalLines: number, offsetFromBottom: number, viewportSize: number, renderedLines: number): string[] {
  if (totalLines <= viewportSize || renderedLines === 0) {
    return Array.from({ length: renderedLines }, () => " ");
  }

  const maxOffset = Math.max(totalLines - viewportSize, 0);
  const scrollTop = maxOffset - offsetFromBottom;
  const thumbSize = Math.max(1, Math.round((viewportSize / totalLines) * renderedLines));
  const maxThumbTop = Math.max(renderedLines - thumbSize, 0);
  const thumbTop = maxOffset === 0 ? 0 : Math.round((scrollTop / maxOffset) * maxThumbTop);

  return Array.from({ length: renderedLines }, (_, index) =>
    index >= thumbTop && index < thumbTop + thumbSize ? "█" : "│"
  );
}

function eventTextStyle(line: string): { color?: string; dimColor?: boolean; bold?: boolean } {
  if (line.startsWith("你：")) {
    return { color: "cyan", bold: true };
  }
  if (line.startsWith("步骤：")) {
    return { color: "blue" };
  }
  if (line.startsWith("推理：")) {
    return { color: "gray", dimColor: true };
  }
  if (line.startsWith("工具开始：")) {
    return { color: "yellow" };
  }
  if (line.startsWith("工具完成：") || line.startsWith("验证通过：") || line.startsWith("模型已配置：")) {
    return { color: "green" };
  }
  if (line.startsWith("工具失败：") || line.startsWith("验证失败：") || line.startsWith("任务失败：") || line.startsWith("Agent 会话失败：")) {
    return { color: "red" };
  }
  if (line.startsWith("COMMANDS") || line.startsWith("准备就绪")) {
    return { color: "gray", dimColor: true };
  }
  return {};
}

function renderCommandMenu(mode: string, selectedCommand: number) {
  if (mode !== "command") {
    return [];
  }

  return [
    h(Text, { dimColor: true }, () => "COMMANDS"),
    ...commandOptions.map((option, index) =>
      h(Text, { color: index === selectedCommand ? "green" : undefined }, () => `${index === selectedCommand ? ">" : " "} ${option.label}  ${option.description}`)
    )
  ];
}

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

function inputLabel(mode: string): string {
  if (mode === "command") {
    return "/";
  }
  if (mode === "chat") {
    return ">";
  }
  return "配置>";
}

function formatModel(config: AgentConfig): string {
  return `${config.provider ?? "未配置"}/${config.model ?? "未配置"}`;
}

function wrap(value: number, length: number): number {
  return (value + length) % length;
}
