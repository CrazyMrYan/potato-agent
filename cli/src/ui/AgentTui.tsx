import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import {
  GitDiffService,
  JsonlTraceStore,
  McpConfigChecker,
  SkillManager,
  type AgentConfig,
  type AgentMcpServerConfig,
  type AgentPermissionMode,
  type AgentSkillConfig,
  type AgentSession,
  type DiffService,
  type McpCheckResult,
  type TraceStore
} from "@coding-agent/core";
import { EventStreamRenderer, type RenderedAgentEvent, type RenderedAgentEventKind } from "./EventStreamRenderer.js";

export type AgentTuiProps = {
  config: AgentConfig;
  createSession?: (config: AgentConfig) => AgentSession;
  saveConfig?: (config: AgentConfig) => Promise<void>;
  diffService?: DiffService;
  traceStore?: TraceStore;
  skillManager?: SkillManager;
  mcpChecker?: McpConfigChecker;
};

type Mode =
  | "chat"
  | "command"
  | "model-provider"
  | "model-model"
  | "model-key"
  | "permission-mode"
  | "skill-list"
  | "skill-install"
  | "mcp-menu"
  | "agent-menu";

const providerOptions = ["deepseek", "openai", "anthropic", "gemini", "mistral"] as const;
const modelOptions: Record<string, string[]> = {
  deepseek: ["deepseek-reasoner", "deepseek-chat"],
  openai: ["gpt-5.5", "gpt-5"],
  anthropic: ["claude-opus-4-5", "claude-sonnet-4-5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  mistral: ["mistral-large-latest", "codestral-latest"]
};

const commandOptions = [
  { command: "/model", label: "/model", description: "配置 provider、model 和 API Key" },
  { command: "/workspace", label: "/workspace", description: "显示当前工作区" },
  { command: "/diff", label: "/diff", description: "显示当前 Git 变更" },
  { command: "/trace", label: "/trace", description: "显示最近 trace" },
  { command: "/mode", label: "/mode", description: "打开权限模式选择" },
  { command: "/skill", label: "/skill", description: "管理 skills" },
  { command: "/mcp", label: "/mcp", description: "检测 MCP 配置" },
  { command: "/agent", label: "/agent", description: "选择 SubAgent" },
  { command: "/exit", label: "/exit", description: "退出 TUI" }
];

const permissionOptions: Array<{ label: string; mode: AgentPermissionMode }> = [
  { label: "manual", mode: "confirm" },
  { label: "auto", mode: "bypass" },
  { label: "readonly", mode: "readonly" }
];

export function AgentTui(props: AgentTuiProps): React.ReactElement {
  const app = useApp();
  const stdout = useStdout();
  const [config, setConfig] = useState<AgentConfig>({ ...props.config });
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [mode, setMode] = useState<Mode>("chat");
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState(() => {
    const index = providerOptions.findIndex((provider) => provider === props.config.provider);
    return index >= 0 ? index : 0;
  });
  const [selectedModel, setSelectedModel] = useState(0);
  const [selectedPermission, setSelectedPermission] = useState(0);
  const [selectedSkill, setSelectedSkill] = useState(0);
  const [skillInstallInput, setSkillInstallInput] = useState("");
  const [skillItems, setSkillItems] = useState<AgentSkillConfig[]>([]);
  const [mcpResults, setMcpResults] = useState<McpCheckResult[]>([]);
  const [pendingApiKey, setPendingApiKey] = useState(props.config.apiKey ?? "");
  const [events, setEvents] = useState<RenderedAgentEvent[]>([
    { kind: "muted", text: "准备就绪。输入任务开始，输入 / 打开命令菜单。" }
  ]);
  const sessionRef = useRef<AgentSession | undefined>(undefined);
  const workspacePath = config.workspacePath ?? process.cwd();
  const permissionMode = config.permissionPolicy?.mode ?? "confirm";
  const skillManager = props.skillManager ?? new SkillManager(workspacePath);
  const mcpChecker = props.mcpChecker ?? new McpConfigChecker({ adapter: "rpc" });

  const visibleEventCapacity = Math.max(8, Math.min(24, stdout.stdout.rows - 9));
  const maxScrollOffset = Math.max(events.length - visibleEventCapacity, 0);
  const visibleEvents = useMemo(() => {
    const end = Math.max(events.length - scrollOffset, 0);
    const start = Math.max(end - visibleEventCapacity, 0);
    return events.slice(start, end);
  }, [events, scrollOffset, visibleEventCapacity]);

  const appendEvent = useCallback((event: RenderedAgentEvent) => {
    setEvents((current) => [...current, event]);
    setScrollOffset(0);
  }, []);

  const appendEvents = useCallback((nextEvents: RenderedAgentEvent[]) => {
    const filtered = nextEvents.filter((event) => event.text.length > 0);
    if (filtered.length === 0) {
      return;
    }
    setEvents((current) => [...current, ...filtered]);
    setScrollOffset(0);
  }, []);

  const enterModelProviderMode = useCallback(() => {
    const currentIndex = providerOptions.findIndex((provider) => provider === config.provider);
    const nextProviderIndex = currentIndex >= 0 ? currentIndex : 0;
    const models = modelOptions[providerOptions[nextProviderIndex]];
    const modelIndex = models.findIndex((model) => model === config.model);
    setSelectedProvider(nextProviderIndex);
    setSelectedModel(modelIndex >= 0 ? modelIndex : 0);
    setPendingApiKey(config.apiKey ?? "");
    setMode("model-provider");
    appendEvent({ kind: "muted", text: "打开模型配置。" });
  }, [appendEvent, config]);

  const saveModelConfig = useCallback(async () => {
    const provider = providerOptions[selectedProvider];
    const model = modelOptions[provider][selectedModel];
    const nextConfig: AgentConfig = {
      ...config,
      provider,
      model,
      apiKey: pendingApiKey || undefined
    };
    setConfig(nextConfig);
    setMode("chat");
    if (sessionRef.current) {
      await sessionRef.current.stop();
      sessionRef.current = undefined;
    }
    await props.saveConfig?.(nextConfig);
    appendEvent({ kind: "success", text: `模型已配置：${formatModel(nextConfig)}` });
  }, [appendEvent, config, pendingApiKey, props, selectedModel, selectedProvider]);

  const savePermissionMode = useCallback(
    async (mode: AgentPermissionMode) => {
      const nextConfig: AgentConfig = {
        ...config,
        permissionPolicy: {
          ...config.permissionPolicy,
          mode
        }
      };
      setConfig(nextConfig);
      await props.saveConfig?.(nextConfig);
      appendEvent({ kind: "success", text: `权限模式已设置：${formatPermissionMode(mode)}` });
    },
    [appendEvent, config, props]
  );

  const openPermissionMode = useCallback(() => {
    const index = permissionOptions.findIndex((option) => option.mode === permissionMode);
    setSelectedPermission(index >= 0 ? index : 0);
    setMode("permission-mode");
  }, [permissionMode]);

  const openSkillList = useCallback(async () => {
    const skills = await skillManager.list();
    setSkillItems(skills);
    setSelectedSkill(0);
    setMode("skill-list");
  }, [skillManager]);

  const toggleSelectedSkill = useCallback(async () => {
    const skill = skillItems[selectedSkill];
    if (!skill?.id) {
      return;
    }
    await skillManager.setEnabled(skill.id, skill.enabled === false);
    await openSkillList();
  }, [openSkillList, selectedSkill, skillItems, skillManager]);

  const installSkill = useCallback(async () => {
    const source = skillInstallInput.trim();
    if (!source) {
      return;
    }
    const installed = await skillManager.install(source);
    setSkillInstallInput("");
    appendEvent({ kind: "success", text: `skill installed: ${installed.name ?? installed.id}` });
    await openSkillList();
  }, [appendEvent, openSkillList, skillInstallInput, skillManager]);

  const openMcpMenu = useCallback(async () => {
    const servers = config.mcpServers ?? [];
    const results: McpCheckResult[] = [];
    for (const server of servers) {
      results.push(await mcpChecker.check(server));
    }
    setMcpResults(results);
    setMode("mcp-menu");
  }, [config.mcpServers, mcpChecker]);

  const showDiff = useCallback(async () => {
    const diffService = props.diffService ?? new GitDiffService();
    const changeSet = await diffService.getChangeSet(workspacePath);
    if (changeSet.files.length === 0) {
      appendEvent({ kind: "muted", text: "diff: 当前没有 Git 变更。" });
      return;
    }
    appendEvent({ kind: "diff", text: `diff: ${changeSet.files.length} 个文件变更。` });
    appendEvents(changeSet.files.map((file) => ({ kind: "diff", text: `${file.status} ${file.path}` })));
  }, [appendEvent, appendEvents, props.diffService, workspacePath]);

  const showTrace = useCallback(async () => {
    const traceStore = props.traceStore ?? new JsonlTraceStore(workspacePath);
    const traces = await traceStore.list();
    if (traces.length === 0) {
      appendEvent({ kind: "muted", text: "trace: 还没有执行过 agent 任务。" });
      return;
    }
    appendEvent({ kind: "muted", text: `trace: 最近 ${Math.min(traces.length, 5)} 条。` });
    appendEvents(
      traces.slice(0, 5).map((trace) => ({
        kind: "muted",
        text: `${trace.taskId} ${trace.entries} entries ${trace.updatedAt}`
      }))
    );
  }, [appendEvent, appendEvents, props.traceStore, workspacePath]);

  const sendPrompt = useCallback(
    async (prompt: string) => {
      if (busy) {
        appendEvent({ kind: "warning", text: "当前还有任务在运行，请等待完成。" });
        return;
      }

      setBusy(true);
      appendEvent({ kind: "user", text: prompt });

      try {
        const activeSession = sessionRef.current ?? props.createSession?.(config);
        if (!activeSession) {
          appendEvent({ kind: "error", text: "Agent 会话创建失败：缺少 core session factory。" });
          return;
        }

        if (!sessionRef.current) {
          await activeSession.start();
          sessionRef.current = activeSession;
        }

        const renderer = new EventStreamRenderer({ colors: false });
        for await (const event of activeSession.send(prompt)) {
          appendEvents(renderer.renderEvent(event));
        }
        appendEvents(renderer.flushEvents());
      } catch (error) {
        appendEvent({ kind: "error", text: `Agent 会话失败：${error instanceof Error ? error.message : String(error)}` });
      } finally {
        setBusy(false);
      }
    },
    [appendEvent, appendEvents, busy, config, props]
  );

  const handlePrompt = useCallback(
    async (prompt: string) => {
      if (!prompt) {
        return;
      }

      if (prompt === "/exit" || prompt === "/quit") {
        await sessionRef.current?.stop();
        app.exit();
        return;
      }

      if (prompt === "/workspace") {
        appendEvent({ kind: "muted", text: `workspace: ${workspacePath}` });
        return;
      }

      if (prompt === "/model") {
        enterModelProviderMode();
        return;
      }

      if (prompt === "/mode") {
        openPermissionMode();
        return;
      }

      if (prompt === "/skill") {
        await openSkillList();
        return;
      }

      if (prompt === "/mcp") {
        await openMcpMenu();
        return;
      }

      if (prompt === "/agent" || prompt === "/subagent") {
        setMode("agent-menu");
        return;
      }

      if (prompt === "/diff") {
        await showDiff();
        return;
      }

      if (prompt === "/trace") {
        await showTrace();
        return;
      }

      await sendPrompt(prompt);
    },
    [app, appendEvent, enterModelProviderMode, openMcpMenu, openPermissionMode, openSkillList, sendPrompt, showDiff, showTrace, workspacePath]
  );

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
    };
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      void sessionRef.current?.stop();
      app.exit();
      return;
    }

    if (key.ctrl && input === "w") {
      appendEvent({ kind: "muted", text: `workspace: ${workspacePath}` });
      return;
    }

    if (mode === "chat" && key.pageUp) {
      setScrollOffset((value) => Math.min(value + 8, maxScrollOffset));
      return;
    }

    if (mode === "chat" && key.pageDown) {
      setScrollOffset((value) => Math.max(value - 8, 0));
      return;
    }

    if (mode === "chat" && key.upArrow && draft.length === 0) {
      setScrollOffset((value) => Math.min(value + 1, maxScrollOffset));
      return;
    }

    if (mode === "chat" && key.downArrow && draft.length === 0) {
      setScrollOffset((value) => Math.max(value - 1, 0));
      return;
    }

    if ((key.ctrl && input === "m") || (mode === "chat" && draft === "/model" && key.return)) {
      setDraft("");
      enterModelProviderMode();
      return;
    }

    if (mode === "command") {
      handleCommandInput(key, setDraft, setMode, setSelectedCommand, handlePrompt);
      return;
    }

    if (mode !== "chat") {
      handleSecondaryInput({
        input,
        key,
        mode,
        selectedProvider,
        selectedPermission,
        selectedSkill,
        skillItems,
        setMode,
        setSelectedProvider,
        setSelectedModel,
        setPendingApiKey,
        setSelectedPermission,
        setSelectedSkill,
        setSkillInstallInput,
        saveModelConfig,
        savePermissionMode,
        toggleSelectedSkill,
        installSkill,
        openSkillList
      });
      return;
    }

    if (key.return) {
      const prompt = draft.trim();
      setDraft("");
      void handlePrompt(prompt);
      return;
    }

    if (key.backspace || key.delete) {
      setDraft((value) => {
        const next = value.slice(0, -1);
        if (!next.startsWith("/")) {
          setMode("chat");
        }
        return next;
      });
      return;
    }

    if (input) {
      setDraft((value) => {
        const next = value + input;
        if (next.startsWith("/")) {
          setMode("command");
          setSelectedCommand(0);
        }
        return next;
      });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="round" borderColor={busy ? "yellow" : "cyan"} paddingX={1} flexDirection="column">
        <Box justifyContent="space-between" flexWrap="wrap">
          <Text bold color="cyan">Agent</Text>
          <Text color={busy ? "yellow" : "green"}>status {busy ? "running" : "idle"}</Text>
        </Box>
        <Box gap={2} flexWrap="wrap">
          <Text dimColor>model <Text color="white">{formatModel(config)}</Text></Text>
          <Text dimColor>workspace <Text color="white">{workspacePath}</Text></Text>
          <Text dimColor>mode <Text color="white">{formatPermissionMode(permissionMode)}</Text></Text>
        </Box>
        <Box gap={2} flexWrap="wrap">
          <Text dimColor>commands <Text color="white">/model /workspace /diff /trace /mode /skill /mcp /agent /exit</Text></Text>
          <Text dimColor>keys <Text color="white">Ctrl+M PageUp/PageDown Ctrl+C</Text></Text>
        </Box>
      </Box>

      <Box marginTop={1} paddingX={1} flexDirection="column" minHeight={visibleEventCapacity} overflow="hidden">
        <Text dimColor>
          transcript{events.length > visibleEventCapacity
            ? ` · ${Math.max(events.length - visibleEventCapacity - scrollOffset + 1, 1)}-${Math.max(events.length - scrollOffset, 1)}/${events.length}`
            : ""}
        </Text>
        {visibleEvents.map((event, index) => (
          <EventLine event={event} key={`${index}-${event.kind}-${event.text}`} />
        ))}
        <CommandMenu mode={mode} selectedCommand={selectedCommand} />
        <ModelPicker mode={mode} selectedProvider={selectedProvider} selectedModel={selectedModel} pendingApiKey={pendingApiKey} />
        <PermissionPicker mode={mode} selectedPermission={selectedPermission} />
        <SkillList mode={mode} skills={skillItems} selectedSkill={selectedSkill} skillInstallInput={skillInstallInput} />
        <McpMenu mode={mode} servers={config.mcpServers ?? []} results={mcpResults} />
        <AgentMenu mode={mode} />
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor={mode === "chat" ? "gray" : "cyan"} paddingX={1}>
        <Text color="cyan">input </Text>
        <Text color={mode === "chat" || mode === "command" ? "white" : "cyan"}>
          {inputLabel(mode)} {mode === "chat" || mode === "command" ? draft : secondaryPrompt(mode, skillInstallInput)}
        </Text>
      </Box>
    </Box>
  );
}

function handleCommandInput(
  key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean; backspace: boolean; delete: boolean },
  setDraft: React.Dispatch<React.SetStateAction<string>>,
  setMode: React.Dispatch<React.SetStateAction<Mode>>,
  setSelectedCommand: React.Dispatch<React.SetStateAction<number>>,
  handlePrompt: (prompt: string) => Promise<void>
): void {
  if (key.escape) {
    setDraft("");
    setMode("chat");
    return;
  }

  if (key.upArrow) {
    setSelectedCommand((value) => wrap(value - 1, commandOptions.length));
    return;
  }

  if (key.downArrow) {
    setSelectedCommand((value) => wrap(value + 1, commandOptions.length));
    return;
  }

  if (key.backspace || key.delete) {
    setDraft((value) => {
      const next = value.slice(0, -1);
      if (!next.startsWith("/")) {
        setMode("chat");
      }
      return next;
    });
    return;
  }

  if (key.return) {
    setSelectedCommand((value) => {
      setDraft("");
      setMode("chat");
      void handlePrompt(commandOptions[value].command);
      return value;
    });
  }
}

type SecondaryInputOptions = {
  input: string;
  key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean; backspace: boolean; delete: boolean };
  mode: Mode;
  selectedProvider: number;
  selectedPermission: number;
  selectedSkill: number;
  skillItems: AgentSkillConfig[];
  setMode: React.Dispatch<React.SetStateAction<Mode>>;
  setSelectedProvider: React.Dispatch<React.SetStateAction<number>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<number>>;
  setPendingApiKey: React.Dispatch<React.SetStateAction<string>>;
  setSelectedPermission: React.Dispatch<React.SetStateAction<number>>;
  setSelectedSkill: React.Dispatch<React.SetStateAction<number>>;
  setSkillInstallInput: React.Dispatch<React.SetStateAction<string>>;
  saveModelConfig: () => Promise<void>;
  savePermissionMode: (mode: AgentPermissionMode) => Promise<void>;
  toggleSelectedSkill: () => Promise<void>;
  installSkill: () => Promise<void>;
  openSkillList: () => Promise<void>;
};

function handleSecondaryInput(options: SecondaryInputOptions): void {
  const {
    input,
    key,
    mode,
    selectedProvider,
    selectedPermission,
    selectedSkill,
    skillItems,
    setMode,
    setSelectedProvider,
    setSelectedModel,
    setPendingApiKey,
    setSelectedPermission,
    setSelectedSkill,
    setSkillInstallInput,
    saveModelConfig,
    savePermissionMode,
    toggleSelectedSkill,
    installSkill,
    openSkillList
  } = options;

  if (key.escape) {
    setMode("chat");
    return;
  }

  if (mode === "model-provider") {
    if (key.upArrow) {
      setSelectedProvider((value) => wrap(value - 1, providerOptions.length));
      return;
    }
    if (key.downArrow) {
      setSelectedProvider((value) => wrap(value + 1, providerOptions.length));
      return;
    }
    if (key.return) {
      setMode("model-model");
      setSelectedModel(0);
    }
    return;
  }

  if (mode === "model-model") {
    const provider = providerOptions[selectedProvider];
    const models = modelOptions[provider];
    if (key.upArrow) {
      setSelectedModel((value) => wrap(value - 1, models.length));
      return;
    }
    if (key.downArrow) {
      setSelectedModel((value) => wrap(value + 1, models.length));
      return;
    }
    if (key.return) {
      setMode("model-key");
    }
    return;
  }

  if (mode === "model-key") {
    if (key.backspace || key.delete) {
      setPendingApiKey((value) => value.slice(0, -1));
      return;
    }
    if (key.return) {
      void saveModelConfig();
      return;
    }
    if (input) {
      setPendingApiKey((value) => value + input);
    }
  }

  if (mode === "permission-mode") {
    if (key.upArrow) {
      setSelectedPermission((value) => wrap(value - 1, permissionOptions.length));
      return;
    }
    if (key.downArrow) {
      setSelectedPermission((value) => wrap(value + 1, permissionOptions.length));
      return;
    }
    if (key.return) {
      void savePermissionMode(permissionOptions[selectedPermission].mode);
      setMode("chat");
    }
    return;
  }

  if (mode === "skill-list") {
    if (input === "i") {
      setSkillInstallInput("");
      setMode("skill-install");
      return;
    }
    if (input === "r") {
      void openSkillList();
      return;
    }
    if (key.upArrow) {
      setSelectedSkill((value) => wrap(value - 1, Math.max(skillItems.length, 1)));
      return;
    }
    if (key.downArrow) {
      setSelectedSkill((value) => wrap(value + 1, Math.max(skillItems.length, 1)));
      return;
    }
    if (key.return) {
      void toggleSelectedSkill();
    }
    return;
  }

  if (mode === "skill-install") {
    if (key.backspace || key.delete) {
      setSkillInstallInput((value) => value.slice(0, -1));
      return;
    }
    if (key.return) {
      void installSkill();
      return;
    }
    if (input) {
      setSkillInstallInput((value) => value + input);
    }
    return;
  }

  if (mode === "mcp-menu" || mode === "agent-menu") {
    if (key.return) {
      setMode("chat");
    }
  }
}

function EventLine({ event }: { event: RenderedAgentEvent }): React.ReactElement {
  return <Text {...eventTextStyle(event.kind)} wrap="wrap">{event.text}</Text>;
}

function CommandMenu({ mode, selectedCommand }: { mode: Mode; selectedCommand: number }): React.ReactElement | null {
  if (mode !== "command") {
    return null;
  }

  return (
    <>
      <Text dimColor>COMMANDS</Text>
      {commandOptions.map((option, index) => (
        <Text color={index === selectedCommand ? "green" : undefined} key={option.command}>
          {index === selectedCommand ? ">" : " "} {option.label}  {option.description}
        </Text>
      ))}
    </>
  );
}

function ModelPicker({
  mode,
  selectedProvider,
  selectedModel,
  pendingApiKey
}: {
  mode: Mode;
  selectedProvider: number;
  selectedModel: number;
  pendingApiKey: string;
}): React.ReactElement | null {
  if (mode !== "model-provider" && mode !== "model-model" && mode !== "model-key") {
    return null;
  }

  const provider = providerOptions[selectedProvider];
  const models = modelOptions[provider];
  if (mode === "model-provider") {
    return (
      <>
        {providerOptions.map((option, index) => (
          <Text color={index === selectedProvider ? "green" : undefined} key={option}>
            {index === selectedProvider ? ">" : " "} {option}
          </Text>
        ))}
      </>
    );
  }

  if (mode === "model-model") {
    return (
      <>
        {models.map((option, index) => (
          <Text color={index === selectedModel ? "green" : undefined} key={option}>
            {index === selectedModel ? ">" : " "} {option}
          </Text>
        ))}
      </>
    );
  }

  return <Text dimColor>API Key: {pendingApiKey ? "*".repeat(Math.min(pendingApiKey.length, 12)) : "(使用环境变量)"}</Text>;
}

function PermissionPicker({ mode, selectedPermission }: { mode: Mode; selectedPermission: number }): React.ReactElement | null {
  if (mode !== "permission-mode") {
    return null;
  }

  return (
    <>
      <Text dimColor>MODE</Text>
      {permissionOptions.map((option, index) => (
        <Text color={index === selectedPermission ? "green" : undefined} key={option.label}>
          {index === selectedPermission ? ">" : " "} {option.label}
        </Text>
      ))}
    </>
  );
}

function SkillList({
  mode,
  skills,
  selectedSkill,
  skillInstallInput
}: {
  mode: Mode;
  skills: AgentSkillConfig[];
  selectedSkill: number;
  skillInstallInput: string;
}): React.ReactElement | null {
  if (mode === "skill-install") {
    return <Text dimColor>Install skill from Git URL or local path: {skillInstallInput}</Text>;
  }
  if (mode !== "skill-list") {
    return null;
  }

  return (
    <>
      <Text dimColor>SKILLS  Enter toggle · i install · r refresh · Esc back</Text>
      {skills.map((skill, index) => (
        <Text color={index === selectedSkill ? "green" : undefined} key={skill.id ?? skill.path}>
          {index === selectedSkill ? ">" : " "} [{skill.enabled === false ? "disabled" : "enabled"}] {skill.source ?? "local"} {skill.name ?? skill.id ?? skill.path}
        </Text>
      ))}
    </>
  );
}

function McpMenu({
  mode,
  servers,
  results
}: {
  mode: Mode;
  servers: AgentMcpServerConfig[];
  results: McpCheckResult[];
}): React.ReactElement | null {
  if (mode !== "mcp-menu") {
    return null;
  }

  if (servers.length === 0) {
    return <Text dimColor>MCP: no servers configured. Press Enter or Esc to return.</Text>;
  }

  return (
    <>
      <Text dimColor>MCP CHECK</Text>
      {results.map((result) => (
        <Text key={result.name}>{result.name} {result.status} {result.message}</Text>
      ))}
    </>
  );
}

function AgentMenu({ mode }: { mode: Mode }): React.ReactElement | null {
  if (mode !== "agent-menu") {
    return null;
  }

  return <Text dimColor>SubAgent: default agent selected. Custom SubAgent selection will use core SubAgentConfig.</Text>;
}

function eventTextStyle(kind: RenderedAgentEventKind): { color?: string; dimColor?: boolean; bold?: boolean } {
  const styles: Record<RenderedAgentEventKind, { color?: string; dimColor?: boolean; bold?: boolean }> = {
    user: { color: "cyan", bold: true },
    step: { color: "blue" },
    thinking: { color: "gray", dimColor: true },
    text: {},
    tool: { color: "yellow" },
    success: { color: "green" },
    warning: { color: "yellow" },
    error: { color: "red" },
    diff: { color: "magenta" },
    muted: { color: "gray", dimColor: true }
  };
  return styles[kind];
}

function secondaryPrompt(mode: Mode, skillInstallInput: string): string {
  if (mode === "model-provider") {
    return "选择 provider";
  }
  if (mode === "model-model") {
    return "选择 model";
  }
  if (mode === "model-key") {
    return "输入 API Key";
  }
  if (mode === "permission-mode") {
    return "选择权限模式";
  }
  if (mode === "skill-list") {
    return "skills";
  }
  if (mode === "skill-install") {
    return skillInstallInput || "输入 Git URL 或本地路径";
  }
  if (mode === "mcp-menu") {
    return "mcp";
  }
  if (mode === "agent-menu") {
    return "agent";
  }
  return "";
}

function inputLabel(mode: Mode): string {
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

function formatPermissionMode(mode: AgentPermissionMode): string {
  if (mode === "confirm") {
    return "manual";
  }
  if (mode === "bypass") {
    return "auto";
  }
  return "readonly";
}

function wrap(value: number, length: number): number {
  return (value + length) % length;
}
