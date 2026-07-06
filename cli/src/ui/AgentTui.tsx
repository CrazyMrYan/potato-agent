import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import {
  GitDiffService,
  JsonlTraceStore,
  McpConfigChecker,
  RuntimeCapabilityReporter,
  SkillManager,
  SubAgentManager,
  type AgentConfig,
  type AgentMcpServerConfig,
  type AgentPermissionMode,
  type AgentSkillConfig,
  type AgentSession,
  type DiffService,
  type McpCheckResult,
  type SubAgentConfig,
  type TraceStore
} from "@potato/core";
import type { ApprovalRequest } from "@potato/protocol";
import { formatTraceEntry } from "../commands/trace.js";
import { renderChangeSetLines } from "./DiffRenderer.js";
import { EventStreamRenderer, type RenderedAgentEvent, type RenderedAgentEventKind } from "./EventStreamRenderer.js";
import {
  applyCompletion,
  createPromptEditor,
  detectCompletion,
  editPrompt,
  extractSkillMentions,
  renderPromptWithCursor,
  type CompletionContext,
  type PromptEditorState
} from "./PromptEditor.js";

export type AgentTuiProps = {
  config: AgentConfig;
  createSession?: (config: AgentConfig) => AgentSession | Promise<AgentSession>;
  saveConfig?: (config: AgentConfig) => Promise<void>;
  diffService?: DiffService;
  traceStore?: TraceStore;
  skillManager?: SkillManager;
  mcpChecker?: McpConfigChecker;
  subAgentManager?: SubAgentManager;
};

export type SkillListProvider = Pick<SkillManager, "list">;

type Mode =
  | "chat"
  | "command"
  | "model-provider"
  | "model-model"
  | "model-key"
  | "permission-mode"
  | "skill-list"
  | "skill-install"
  | "file-completion"
  | "skill-completion"
  | "mcp-menu"
  | "agent-menu"
  | "approval";

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

const permissionOptions: Array<{ label: string; description: string; mode: AgentPermissionMode }> = [
  { label: "manual", description: "确认后允许写入/命令", mode: "confirm" },
  { label: "auto", description: "自动执行，结束看 diff", mode: "bypass" },
  { label: "readonly", description: "禁止写入和变更命令", mode: "readonly" }
];

const execFileAsync = promisify(execFile);

export function AgentTui(props: AgentTuiProps): React.ReactElement {
  const app = useApp();
  const stdout = useStdout();
  const [config, setConfig] = useState<AgentConfig>({ ...props.config });
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<PromptEditorState>(() => createPromptEditor());
  const [completionContext, setCompletionContext] = useState<CompletionContext | undefined>();
  const [fileCandidates, setFileCandidates] = useState<string[]>([]);
  const [fileCandidatesLoading, setFileCandidatesLoading] = useState(false);
  const [skillCandidates, setSkillCandidates] = useState<string[]>([]);
  const [skillCandidatesLoading, setSkillCandidatesLoading] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [mode, setMode] = useState<Mode>("chat");
  const [selectedCompletion, setSelectedCompletion] = useState(0);
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
  const [subAgentItems, setSubAgentItems] = useState<SubAgentConfig[]>([]);
  const [selectedSubAgent, setSelectedSubAgent] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | undefined>();
  const [pendingApiKey, setPendingApiKey] = useState(props.config.apiKey ?? "");
  const [expandedKinds, setExpandedKinds] = useState({ thinking: false, tool: false, diff: false });
  const [contextStatus, setContextStatus] = useState<string | undefined>();
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | undefined>();
  const [events, setEvents] = useState<RenderedAgentEvent[]>([
    { kind: "muted", text: "准备就绪。输入任务开始，输入 / 打开命令菜单。" }
  ]);
  const sessionRef = useRef<AgentSession | undefined>(undefined);
  const workspacePath = config.workspacePath ?? process.cwd();
  const permissionMode = config.permissionPolicy?.mode ?? "confirm";
  const runtimeCapability = useMemo(() => new RuntimeCapabilityReporter().forAdapter("rpc"), []);
  const skillManager = props.skillManager ?? new SkillManager(workspacePath);
  const mcpChecker = props.mcpChecker ?? new McpConfigChecker({ adapter: "rpc" });
  const subAgentManager = props.subAgentManager ?? new SubAgentManager();

  const visibleEventCapacity = Math.max(8, Math.min(24, stdout.stdout.rows - 9));
  const displayEvents = useMemo(() => filterDisplayEvents(events, expandedKinds), [events, expandedKinds]);
  const maxScrollOffset = Math.max(displayEvents.length - visibleEventCapacity, 0);
  const visibleEvents = useMemo(() => {
    const end = Math.max(displayEvents.length - scrollOffset, 0);
    const start = Math.max(end - visibleEventCapacity, 0);
    return displayEvents.slice(start, end);
  }, [displayEvents, scrollOffset, visibleEventCapacity]);
  const commandMatches = useMemo(() => {
    if (completionContext?.type !== "command") {
      return commandOptions;
    }
    const query = completionContext.query.toLowerCase();
    return commandOptions
      .filter((option) => fuzzyMatch(option.command.toLowerCase(), query))
      .sort((left, right) => completionRank(left.command.toLowerCase(), query) - completionRank(right.command.toLowerCase(), query));
  }, [completionContext]);
  const fileMatches = useMemo(() => {
    if (completionContext?.type !== "file") {
      return [];
    }
    const query = completionContext.query.toLowerCase();
    return filterCompletionCandidates(fileCandidates, query, 12);
  }, [completionContext, fileCandidates]);
  const skillMatches = useMemo(() => {
    if (completionContext?.type !== "skill") {
      return [];
    }
    const query = completionContext.query.toLowerCase();
    return filterCompletionCandidates(skillCandidates, query, 12);
  }, [completionContext, skillCandidates]);

  const appendEvent = useCallback((event: RenderedAgentEvent) => {
    setEvents((current) => [...current, event]);
    setScrollOffset(0);
  }, []);

  const appendEvents = useCallback((nextEvents: RenderedAgentEvent[]) => {
    const contextEvent = nextEvents.find((event) => event.kind === "context" && event.text.length > 0);
    if (contextEvent) {
      setContextStatus(contextEvent.text);
    }
    const filtered = nextEvents.filter((event) => event.kind !== "context" && event.text.length > 0);
    if (filtered.length === 0) {
      return;
    }
    setEvents((current) => [...current, ...filtered]);
    setScrollOffset(0);
  }, []);

  const updateEditor = useCallback((nextEditor: PromptEditorState) => {
    setEditor(nextEditor);
    const nextCompletion = detectCompletion(nextEditor);
    setCompletionContext(nextCompletion);
    setSelectedCompletion(0);
    if (nextCompletion?.type === "command") {
      setMode("command");
      return;
    }
    if (nextCompletion?.type === "file") {
      setMode("file-completion");
      return;
    }
    if (nextCompletion?.type === "skill") {
      setMode("skill-completion");
      return;
    }
    setMode((current) => (current === "command" || current === "file-completion" || current === "skill-completion" ? "chat" : current));
  }, []);

  const stopActiveSession = useCallback(async () => {
    if (!sessionRef.current) {
      return;
    }

    await sessionRef.current.stop();
    sessionRef.current = undefined;
  }, []);

  const buildRuntimeConfig = useCallback(() => buildRuntimeSessionConfig(config, skillManager, subAgentManager), [config, skillManager, subAgentManager]);

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
    await stopActiveSession();
    await props.saveConfig?.(nextConfig);
    appendEvent({ kind: "success", text: `模型已配置：${formatModel(nextConfig)}` });
  }, [appendEvent, config, pendingApiKey, props, selectedModel, selectedProvider, stopActiveSession]);

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
      await stopActiveSession();
      await props.saveConfig?.(nextConfig);
      appendEvent({ kind: "success", text: `权限模式已设置：${formatPermissionMode(mode)}。下一轮会话将使用新的工具边界。` });
    },
    [appendEvent, config, props, stopActiveSession]
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
    await stopActiveSession();
    await openSkillList();
  }, [openSkillList, selectedSkill, skillItems, skillManager, stopActiveSession]);

  const installSkill = useCallback(async () => {
    const source = skillInstallInput.trim();
    if (!source) {
      return;
    }
    const installed = await skillManager.install(source);
    setSkillInstallInput("");
    await stopActiveSession();
    appendEvent({ kind: "success", text: `skill installed: ${installed.name ?? installed.id}` });
    await openSkillList();
  }, [appendEvent, openSkillList, skillInstallInput, skillManager, stopActiveSession]);

  const openMcpMenu = useCallback(async () => {
    const servers = config.mcpServers ?? [];
    const results: McpCheckResult[] = [];
    for (const server of servers) {
      results.push(await mcpChecker.check(server));
    }
    setMcpResults(results);
    setMode("mcp-menu");
  }, [config.mcpServers, mcpChecker]);

  const openAgentMenu = useCallback(async () => {
    const agents = await subAgentManager.list();
    const activeId = config.activeSubAgentId ?? "default";
    const index = agents.findIndex((agent) => agent.id === activeId);
    setSubAgentItems(agents);
    setSelectedSubAgent(index >= 0 ? index : 0);
    setMode("agent-menu");
  }, [config.activeSubAgentId, subAgentManager]);

  const selectSubAgent = useCallback(async () => {
    const agent = subAgentItems[selectedSubAgent];
    if (!agent) {
      return;
    }
    await subAgentManager.select(agent.id);
    const nextConfig = { ...config, activeSubAgentId: agent.id, subAgents: subAgentItems };
    setConfig(nextConfig);
    await stopActiveSession();
    await props.saveConfig?.(nextConfig);
    appendEvent({ kind: "success", text: `SubAgent selected: ${agent.name}` });
    setMode("chat");
  }, [appendEvent, config, props, selectedSubAgent, stopActiveSession, subAgentItems, subAgentManager]);

  const showDiff = useCallback(async () => {
    const diffService = props.diffService ?? new GitDiffService();
    const changeSet = await diffService.getChangeSet(workspacePath);
    if (changeSet.files.length === 0) {
      appendEvent({ kind: "muted", text: "diff: 当前没有 Git 变更。" });
      return;
    }
    appendEvents(renderChangeSetLines(changeSet).map((line) => ({ kind: "diff" as const, text: line })));
  }, [appendEvent, appendEvents, props.diffService, workspacePath]);

  const showTrace = useCallback(async () => {
    const traceStore = props.traceStore ?? new JsonlTraceStore(workspacePath);
    const traces = await traceStore.list();
    if (traces.length === 0) {
      appendEvent({ kind: "muted", text: "trace: 还没有执行过 potato 任务。" });
      return;
    }
    const latest = traces[0];
    appendEvent({ kind: "muted", text: `trace: 最新 ${latest.taskId}，${latest.entries} entries。` });
    const entries = await traceStore.read(latest.taskId);
    appendEvents(entries.slice(-20).map((entry) => ({ kind: "muted", text: formatTraceEntry(entry) })));
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
        const runtimeConfig = applyInlineSkillMentions(await buildRuntimeConfig(), prompt);
        const activeSession = sessionRef.current ?? (await props.createSession?.(runtimeConfig));
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
          if (event.type === "approval.requested") {
            setPendingApproval(event.request);
            setMode("approval");
          }
          appendEvents(renderer.renderEvent(event));
        }
        appendEvents(renderer.flushEvents());
      } catch (error) {
        appendEvent({ kind: "error", text: `Agent 会话失败：${error instanceof Error ? error.message : String(error)}` });
      } finally {
        setBusy(false);
      }
    },
    [appendEvent, appendEvents, buildRuntimeConfig, busy, props]
  );

  const respondToApproval = useCallback(
    async (approved: boolean) => {
      if (!pendingApproval) {
        return;
      }

      try {
        if (approved) {
          await sessionRef.current?.approve(pendingApproval.id, true);
        } else if (sessionRef.current && "rejectAndPause" in sessionRef.current && typeof sessionRef.current.rejectAndPause === "function") {
          await sessionRef.current.rejectAndPause(pendingApproval.id);
          sessionRef.current = undefined;
        } else {
          await sessionRef.current?.approve(pendingApproval.id, false);
          await sessionRef.current?.stop();
          sessionRef.current = undefined;
        }
        appendEvent({
          kind: approved ? "success" : "warning",
          text: approved ? `已允许：${pendingApproval.title}` : `已暂停：${pendingApproval.title}`
        });
      } catch (error) {
        appendEvent({ kind: "error", text: `审批响应失败：${error instanceof Error ? error.message : String(error)}` });
      } finally {
        setPendingApproval(undefined);
        if (!approved) {
          setBusy(false);
        }
        setMode("chat");
      }
    },
    [appendEvent, pendingApproval]
  );

  const pauseActiveTask = useCallback(async () => {
    if (pendingApproval) {
      await respondToApproval(false);
      return;
    }

    if (!sessionRef.current) {
      appendEvent({ kind: "muted", text: "当前没有正在运行的任务。" });
      return;
    }

    try {
      await sessionRef.current.stop();
      sessionRef.current = undefined;
      setBusy(false);
      setPendingApproval(undefined);
      setMode("chat");
      appendEvent({ kind: "warning", text: "当前任务已暂停。" });
    } catch (error) {
      appendEvent({ kind: "error", text: `暂停失败：${error instanceof Error ? error.message : String(error)}` });
    }
  }, [appendEvent, pendingApproval, respondToApproval]);

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
        await openAgentMenu();
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

      setPromptHistory((current) => [...current.filter((item) => item !== prompt), prompt].slice(-50));
      await sendPrompt(prompt);
    },
    [app, appendEvent, enterModelProviderMode, openAgentMenu, openMcpMenu, openPermissionMode, openSkillList, sendPrompt, showDiff, showTrace, workspacePath]
  );

  useEffect(() => {
    return () => {
      void sessionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (completionContext?.type !== "file") {
      setFileCandidatesLoading(false);
      return;
    }
    let cancelled = false;
    setFileCandidatesLoading(true);
    void listWorkspaceFiles(workspacePath).then((files) => {
      if (!cancelled) {
        setFileCandidates(files);
        setFileCandidatesLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setFileCandidates([]);
        setFileCandidatesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [completionContext?.type, workspacePath]);

  useEffect(() => {
    if (completionContext?.type !== "skill") {
      setSkillCandidatesLoading(false);
      return;
    }
    let cancelled = false;
    setSkillCandidatesLoading(true);
    void skillManager.list().then((skills) => {
      if (!cancelled) {
        setSkillCandidates(skills.map((skill) => skill.id ?? skill.name ?? skill.path).filter(Boolean));
        setSkillCandidatesLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setSkillCandidates([]);
        setSkillCandidatesLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [completionContext?.type, skillManager]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      void sessionRef.current?.stop();
      app.exit();
      return;
    }

    if (key.ctrl && input === "p") {
      void pauseActiveTask();
      return;
    }

    if (key.ctrl && input === "w") {
      appendEvent({ kind: "muted", text: `workspace: ${workspacePath}` });
      return;
    }

    if (mode === "chat" && key.ctrl && input === "t") {
      setExpandedKinds((current) => ({ ...current, thinking: !current.thinking }));
      return;
    }

    if (mode === "chat" && (isDetailToggleKey(input, key) || (key.ctrl && input === "o"))) {
      setExpandedKinds((current) => {
        const expanded = !(current.tool && current.thinking && current.diff);
        return { thinking: expanded, tool: expanded, diff: expanded };
      });
      return;
    }

    if (mode === "chat" && key.ctrl && input === "d") {
      setExpandedKinds((current) => ({ ...current, diff: !current.diff }));
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

    if (mode === "chat" && key.upArrow && editor.text.length === 0) {
      const nextIndex = historyIndex === undefined ? promptHistory.length - 1 : Math.max(historyIndex - 1, 0);
      const prompt = promptHistory[nextIndex];
      if (prompt) {
        setHistoryIndex(nextIndex);
        updateEditor(createPromptEditor(prompt));
      } else {
        setScrollOffset((value) => Math.min(value + 1, maxScrollOffset));
      }
      return;
    }

    if (mode === "chat" && key.downArrow && (editor.text.length === 0 || historyIndex !== undefined)) {
      if (historyIndex !== undefined) {
        const nextIndex = historyIndex + 1;
        if (nextIndex < promptHistory.length) {
          setHistoryIndex(nextIndex);
          updateEditor(createPromptEditor(promptHistory[nextIndex]));
        } else {
          setHistoryIndex(undefined);
          updateEditor(createPromptEditor());
        }
      } else {
        setScrollOffset((value) => Math.max(value - 1, 0));
      }
      return;
    }

    if (mode === "chat" && editor.text === "/model" && (key.return || isReturnInput(input))) {
      updateEditor(createPromptEditor());
      enterModelProviderMode();
      return;
    }

    if (mode === "command") {
      if (isReturnInput(input) && commandMatches[selectedCompletion]) {
        const option = commandMatches[selectedCompletion];
        updateEditor(createPromptEditor());
        setMode("chat");
        void handlePrompt(option.command);
        return;
      }
      if (key.return || key.escape || key.upArrow || key.downArrow) {
        handleCompletionInput({
          key,
          matches: commandMatches,
          selectedCompletion,
          setSelectedCompletion,
          applySelected: () => {
            const option = commandMatches[selectedCompletion];
            if (!option) return;
            updateEditor(createPromptEditor());
            setMode("chat");
            void handlePrompt(option.command);
          },
          cancel: () => {
            setMode("chat");
            setCompletionContext(undefined);
          }
        });
        return;
      }
      if (key.backspace || key.delete || input || key.leftArrow || key.rightArrow) {
        if (key.backspace || key.delete) updateEditor(editPrompt(editor, { type: key.backspace ? "backspace" : "delete" }));
        else if (key.leftArrow) updateEditor(editPrompt(editor, { type: "left" }));
        else if (key.rightArrow) updateEditor(editPrompt(editor, { type: "right" }));
        else if (input) updateEditor(editPrompt(editor, { type: "insert", value: input }));
        return;
      }
      return;
    }

    if (mode === "file-completion") {
      if (isReturnInput(input) && fileMatches[selectedCompletion]) {
        updateEditor(applyCompletion(editor, { type: "file", value: fileMatches[selectedCompletion] }));
        setMode("chat");
        return;
      }
      if (key.return || key.escape || key.upArrow || key.downArrow) {
        handleValueCompletionInput({
          key,
          matches: fileMatches,
          selectedCompletion,
          setSelectedCompletion,
          applySelected: () => {
            const value = fileMatches[selectedCompletion];
            if (!value) return;
            updateEditor(applyCompletion(editor, { type: "file", value }));
            setMode("chat");
          },
          cancel: () => {
            setMode("chat");
            setCompletionContext(undefined);
          }
        });
        return;
      }
      if (key.backspace || key.delete || input || key.leftArrow || key.rightArrow) {
        if (key.backspace || key.delete) updateEditor(editPrompt(editor, { type: key.backspace ? "backspace" : "delete" }));
        else if (key.leftArrow) updateEditor(editPrompt(editor, { type: "left" }));
        else if (key.rightArrow) updateEditor(editPrompt(editor, { type: "right" }));
        else if (input) updateEditor(editPrompt(editor, { type: "insert", value: input }));
        return;
      }
      return;
    }

    if (mode === "skill-completion") {
      if (isReturnInput(input) && skillMatches[selectedCompletion]) {
        updateEditor(applyCompletion(editor, { type: "skill", value: skillMatches[selectedCompletion] }));
        setMode("chat");
        return;
      }
      if (key.return || key.escape || key.upArrow || key.downArrow) {
        handleValueCompletionInput({
          key,
          matches: skillMatches,
          selectedCompletion,
          setSelectedCompletion,
          applySelected: () => {
            const value = skillMatches[selectedCompletion];
            if (!value) return;
            updateEditor(applyCompletion(editor, { type: "skill", value }));
            setMode("chat");
          },
          cancel: () => {
            setMode("chat");
            setCompletionContext(undefined);
          }
        });
        return;
      }
      if (key.backspace || key.delete || input || key.leftArrow || key.rightArrow) {
        if (key.backspace || key.delete) updateEditor(editPrompt(editor, { type: key.backspace ? "backspace" : "delete" }));
        else if (key.leftArrow) updateEditor(editPrompt(editor, { type: "left" }));
        else if (key.rightArrow) updateEditor(editPrompt(editor, { type: "right" }));
        else if (input) updateEditor(editPrompt(editor, { type: "insert", value: input }));
        return;
      }
      return;
    }

    if (mode === "approval") {
      if (key.escape || input === "n" || input === "N" || input === "p" || input === "P") {
        void respondToApproval(false);
        return;
      }
      if (key.return || input === "y" || input === "Y") {
        void respondToApproval(true);
      }
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
        selectedSubAgent,
        skillItems,
        subAgentItems,
        setMode,
        setSelectedProvider,
        setSelectedModel,
        setPendingApiKey,
        setSelectedPermission,
        setSelectedSkill,
        setSelectedSubAgent,
        setSkillInstallInput,
        saveModelConfig,
        savePermissionMode,
        toggleSelectedSkill,
        installSkill,
        openSkillList,
        selectSubAgent
      });
      return;
    }

    if (key.return || isReturnInput(input)) {
      const prompt = editor.text.trim();
      updateEditor(createPromptEditor());
      setHistoryIndex(undefined);
      void handlePrompt(prompt);
      return;
    }

    if (key.backspace || key.delete) {
      updateEditor(editPrompt(editor, { type: key.backspace ? "backspace" : "delete" }));
      setHistoryIndex(undefined);
      return;
    }

    if (key.leftArrow) {
      updateEditor(editPrompt(editor, { type: "left" }));
      return;
    }

    if (key.rightArrow) {
      updateEditor(editPrompt(editor, { type: "right" }));
      return;
    }

    if (key.upArrow) {
      updateEditor(editPrompt(editor, { type: "home" }));
      return;
    }

    if (key.downArrow) {
      updateEditor(editPrompt(editor, { type: "end" }));
      return;
    }

    if (input) {
      updateEditor(editPrompt(editor, { type: "insert", value: input }));
      setHistoryIndex(undefined);
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
          <Text dimColor>subagent <Text color="white">{config.activeSubAgentId ?? "default"}</Text></Text>
          <Text dimColor>network <Text color="white">{runtimeCapability.network}</Text></Text>
        </Box>
        <Box gap={2} flexWrap="wrap">
          <Text dimColor>commands <Text color="white">/model /workspace /diff /trace /mode /skill /mcp /agent /exit</Text></Text>
          <Text dimColor>keys <Text color="white">Ctrl+P PageUp/PageDown F12 details Ctrl+C</Text></Text>
        </Box>
      </Box>

      <Box marginTop={1} paddingX={1} flexDirection="column" minHeight={visibleEventCapacity} overflow="hidden">
        <Text dimColor>
          transcript{displayEvents.length > visibleEventCapacity
            ? ` · ${Math.max(displayEvents.length - visibleEventCapacity - scrollOffset + 1, 1)}-${Math.max(displayEvents.length - scrollOffset, 1)}/${displayEvents.length}`
            : ""}
        </Text>
        {visibleEvents.map((event, index) => (
          <EventLine event={event} key={`${index}-${event.kind}-${event.text}`} />
        ))}
        <CommandMenu mode={mode} selectedCommand={selectedCompletion} commands={commandMatches} />
        <ValueCompletionMenu
          title="FILES"
          mode={mode}
          expectedMode="file-completion"
          selected={selectedCompletion}
          values={fileMatches}
          loading={fileCandidatesLoading}
          query={completionContext?.type === "file" ? completionContext.query : ""}
          loadedCount={fileCandidates.length}
        />
        <ValueCompletionMenu
          title="SKILLS"
          mode={mode}
          expectedMode="skill-completion"
          selected={selectedCompletion}
          values={skillMatches}
          loading={skillCandidatesLoading}
          query={completionContext?.type === "skill" ? completionContext.query : ""}
          loadedCount={skillCandidates.length}
        />
        <ModelPicker mode={mode} selectedProvider={selectedProvider} selectedModel={selectedModel} pendingApiKey={pendingApiKey} />
        <PermissionPicker mode={mode} selectedPermission={selectedPermission} />
        <SkillList mode={mode} skills={skillItems} selectedSkill={selectedSkill} skillInstallInput={skillInstallInput} />
        <McpMenu mode={mode} servers={config.mcpServers ?? []} results={mcpResults} />
        <AgentMenu mode={mode} agents={subAgentItems} selectedSubAgent={selectedSubAgent} activeSubAgentId={config.activeSubAgentId ?? "default"} />
        <ApprovalPrompt mode={mode} request={pendingApproval} />
      </Box>

      <Box paddingX={1}>
        <Text dimColor>{contextStatus ?? "context waiting for first turn"}</Text>
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor={mode === "chat" ? "gray" : "cyan"} paddingX={1}>
        {isPromptEditingMode(mode) ? <PromptLine editor={editor} /> : <Text color="cyan">{secondaryPrompt(mode, skillInstallInput)}</Text>}
      </Box>
    </Box>
  );
}

export async function buildRuntimeSessionConfig(
  config: AgentConfig,
  skillManager: SkillListProvider,
  subAgentManager?: Pick<SubAgentManager, "applyActive">
): Promise<AgentConfig> {
  const skills = await skillManager.list();
  const runtimeConfig = {
    ...config,
    skills
  };
  return subAgentManager ? subAgentManager.applyActive(runtimeConfig) : runtimeConfig;
}

export function applyInlineSkillMentions(config: AgentConfig, prompt: string): AgentConfig {
  const mentions = extractSkillMentions(prompt);
  if (mentions.length === 0 || !config.skills) {
    return config;
  }

  const wanted = new Set(mentions);
  return {
    ...config,
    skills: config.skills.map((skill) => {
      const id = skill.id ?? skill.name ?? skill.path;
      return wanted.has(id) ? { ...skill, enabled: true } : skill;
    }),
    appendSystemPrompt: [...(config.appendSystemPrompt ?? []), `Inline skills for this turn: ${mentions.join(", ")}`]
  };
}

function handleCompletionInput(options: {
  key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean; backspace: boolean; delete: boolean };
  matches: Array<{ command: string; label: string; description: string }>;
  selectedCompletion: number;
  setSelectedCompletion: React.Dispatch<React.SetStateAction<number>>;
  applySelected: () => void;
  cancel: () => void;
}): void {
  const { key, matches, selectedCompletion, setSelectedCompletion, applySelected, cancel } = options;
  if (key.escape) {
    cancel();
    return;
  }

  if (key.upArrow) {
    setSelectedCompletion((value) => wrap(value - 1, Math.max(matches.length, 1)));
    return;
  }

  if (key.downArrow) {
    setSelectedCompletion((value) => wrap(value + 1, Math.max(matches.length, 1)));
    return;
  }

  if (key.return && matches[selectedCompletion]) {
    applySelected();
    return;
  }
}

function handleValueCompletionInput(options: {
  key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean; backspace: boolean; delete: boolean };
  matches: string[];
  selectedCompletion: number;
  setSelectedCompletion: React.Dispatch<React.SetStateAction<number>>;
  applySelected: () => void;
  cancel: () => void;
}): void {
  const { key, matches, selectedCompletion, setSelectedCompletion, applySelected, cancel } = options;
  if (key.escape) {
    cancel();
    return;
  }
  if (key.upArrow) {
    setSelectedCompletion((value) => wrap(value - 1, Math.max(matches.length, 1)));
    return;
  }
  if (key.downArrow) {
    setSelectedCompletion((value) => wrap(value + 1, Math.max(matches.length, 1)));
    return;
  }
  if (key.return && matches[selectedCompletion]) {
    applySelected();
  }
}

type SecondaryInputOptions = {
  input: string;
  key: { upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean; backspace: boolean; delete: boolean };
  mode: Mode;
  selectedProvider: number;
  selectedPermission: number;
  selectedSkill: number;
  selectedSubAgent: number;
  skillItems: AgentSkillConfig[];
  subAgentItems: SubAgentConfig[];
  setMode: React.Dispatch<React.SetStateAction<Mode>>;
  setSelectedProvider: React.Dispatch<React.SetStateAction<number>>;
  setSelectedModel: React.Dispatch<React.SetStateAction<number>>;
  setPendingApiKey: React.Dispatch<React.SetStateAction<string>>;
  setSelectedPermission: React.Dispatch<React.SetStateAction<number>>;
  setSelectedSkill: React.Dispatch<React.SetStateAction<number>>;
  setSelectedSubAgent: React.Dispatch<React.SetStateAction<number>>;
  setSkillInstallInput: React.Dispatch<React.SetStateAction<string>>;
  saveModelConfig: () => Promise<void>;
  savePermissionMode: (mode: AgentPermissionMode) => Promise<void>;
  toggleSelectedSkill: () => Promise<void>;
  installSkill: () => Promise<void>;
  openSkillList: () => Promise<void>;
  selectSubAgent: () => Promise<void>;
};

function handleSecondaryInput(options: SecondaryInputOptions): void {
  const {
    input,
    key,
    mode,
    selectedProvider,
    selectedPermission,
    selectedSkill,
    selectedSubAgent,
    skillItems,
    subAgentItems,
    setMode,
    setSelectedProvider,
    setSelectedModel,
    setPendingApiKey,
    setSelectedPermission,
    setSelectedSkill,
    setSelectedSubAgent,
    setSkillInstallInput,
    saveModelConfig,
    savePermissionMode,
    toggleSelectedSkill,
    installSkill,
    openSkillList,
    selectSubAgent
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

  if (mode === "agent-menu") {
    if (key.upArrow) {
      setSelectedSubAgent((value) => wrap(value - 1, Math.max(subAgentItems.length, 1)));
      return;
    }
    if (key.downArrow) {
      setSelectedSubAgent((value) => wrap(value + 1, Math.max(subAgentItems.length, 1)));
      return;
    }
    if (key.return) {
      void selectSubAgent();
    }
    return;
  }

  if (mode === "mcp-menu") {
    if (key.return) {
      setMode("chat");
    }
  }
}

function EventLine({ event }: { event: RenderedAgentEvent }): React.ReactElement {
  return <Text {...eventTextStyle(event.kind)} wrap="wrap">{event.text}</Text>;
}

function filterDisplayEvents(
  events: RenderedAgentEvent[],
  expandedKinds: { thinking: boolean; tool: boolean; diff: boolean }
): RenderedAgentEvent[] {
  const filtered: RenderedAgentEvent[] = [];
  let hiddenThinking = 0;
  let hiddenTool = 0;
  let hiddenDiff = 0;

  for (const event of events) {
    if (event.kind === "thinking" && !expandedKinds.thinking) {
      hiddenThinking++;
      continue;
    }

    if ((event.kind === "tool" || event.kind === "success" || event.kind === "error") && !expandedKinds.tool && looksLikeToolOutput(event.text)) {
      hiddenTool++;
      continue;
    }

    if (event.kind === "diff" && !expandedKinds.diff && isDiffDetailLine(event.text)) {
      hiddenDiff++;
      continue;
    }

    filtered.push(event);
  }

  if (hiddenThinking > 0) {
    filtered.push({ kind: "muted", text: `Thinking collapsed (${hiddenThinking}) · press F12` });
  }
  if (hiddenTool > 0) {
    filtered.push({ kind: "muted", text: `Tool output collapsed (${hiddenTool}) · press F12` });
  }
  if (hiddenDiff > 0) {
    filtered.push({ kind: "muted", text: `Diff detail collapsed (${hiddenDiff}) · press F12` });
  }

  return filtered;
}

function looksLikeToolOutput(text: string): boolean {
  return /^(bash|read|ls|grep|find|edit|write)\b/.test(text);
}

function isDiffDetailLine(text: string): boolean {
  return text.startsWith("+ ") || text.startsWith("- ") || text.startsWith("  @@") || text.startsWith("  diff --git") || text.startsWith("  index ");
}

function PromptLine({ editor }: { editor: PromptEditorState }): React.ReactElement {
  const segments = renderPromptWithCursor(editor);
  return (
    <Text wrap="truncate">
      {segments.map((segment, index) => (
        <Text color={segment.kind === "file" ? "cyan" : segment.kind === "skill" ? "magenta" : "white"} key={`${index}-${segment.kind}-${segment.text}`}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

function CommandMenu({
  mode,
  selectedCommand,
  commands
}: {
  mode: Mode;
  selectedCommand: number;
  commands: Array<{ command: string; label: string; description: string }>;
}): React.ReactElement | null {
  if (mode !== "command") {
    return null;
  }

  return (
    <>
      <Text dimColor>COMMANDS</Text>
      {commands.map((option, index) => (
        <Text color={index === selectedCommand ? "green" : undefined} key={option.command}>
          {index === selectedCommand ? ">" : " "} {option.label}  {option.description}
        </Text>
      ))}
    </>
  );
}

function ValueCompletionMenu({
  title,
  mode,
  expectedMode,
  selected,
  values,
  loading,
  query,
  loadedCount
}: {
  title: string;
  mode: Mode;
  expectedMode: Mode;
  selected: number;
  values: string[];
  loading: boolean;
  query: string;
  loadedCount: number;
}): React.ReactElement | null {
  if (mode !== expectedMode) {
    return null;
  }
  return (
    <>
      <Text dimColor>{title}  query "{query}" · {loadedCount} loaded</Text>
      {loading ? (
        <Text dimColor>  loading...</Text>
      ) : values.length === 0 ? (
        <Text dimColor>  no matches</Text>
      ) : (
        values.map((value, index) => (
          <Text color={index === selected ? "green" : undefined} key={value}>
            {index === selected ? ">" : " "} {value}
          </Text>
        ))
      )}
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
          {index === selectedPermission ? ">" : " "} {option.label}  {option.description}
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

function AgentMenu({
  mode,
  agents,
  selectedSubAgent,
  activeSubAgentId
}: {
  mode: Mode;
  agents: SubAgentConfig[];
  selectedSubAgent: number;
  activeSubAgentId: string;
}): React.ReactElement | null {
  if (mode !== "agent-menu") {
    return null;
  }

  return (
    <>
      <Text dimColor>SUBAGENTS  Enter select · Esc back</Text>
      {agents.map((agent, index) => (
        <Text color={index === selectedSubAgent ? "green" : undefined} key={agent.id}>
          {index === selectedSubAgent ? ">" : " "} {agent.id === activeSubAgentId ? "*" : " "} {agent.name}  {agent.description}
        </Text>
      ))}
    </>
  );
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
    context: { color: "gray", dimColor: true },
    muted: { color: "gray", dimColor: true }
  };
  return styles[kind];
}

function ApprovalPrompt({ mode, request }: { mode: Mode; request: ApprovalRequest | undefined }): React.ReactElement | null {
  if (mode !== "approval" || !request) {
    return null;
  }

  return (
    <>
      <Text color="yellow">APPROVAL REQUIRED</Text>
      <Text>{request.title}</Text>
      {request.detail ? <ApprovalDetail detail={request.detail} /> : null}
      <Text dimColor>Enter/y allow · n/Esc pause task</Text>
    </>
  );
}

function ApprovalDetail({ detail }: { detail: string }): React.ReactElement {
  return (
    <>
      {detail.split("\n").slice(0, 120).map((line, index) => (
        <Text {...approvalDetailStyle(line)} key={`${index}-${line}`}>
          {line}
        </Text>
      ))}
      {detail.split("\n").length > 120 ? <Text dimColor>... preview truncated ...</Text> : null}
    </>
  );
}

function approvalDetailStyle(line: string): { color?: string; dimColor?: boolean } {
  if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@") || line.startsWith("File:")) {
    return { color: "gray", dimColor: true };
  }
  if (line.startsWith("+")) {
    return { color: "green" };
  }
  if (line.startsWith("-")) {
    return { color: "red" };
  }
  return {};
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
  if (mode === "file-completion") {
    return "选择文件";
  }
  if (mode === "skill-completion") {
    return "选择 skill";
  }
  if (mode === "mcp-menu") {
    return "mcp";
  }
  if (mode === "agent-menu") {
    return "agent";
  }
  if (mode === "approval") {
    return "等待确认 y/n";
  }
  return "";
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

function fuzzyMatch(value: string, query: string): boolean {
  if (!query) {
    return true;
  }
  let cursor = 0;
  for (const char of query) {
    cursor = value.indexOf(char, cursor);
    if (cursor === -1) {
      return false;
    }
    cursor++;
  }
  return true;
}

export function filterCompletionCandidates(candidates: string[], query: string, limit: number): string[] {
  const normalizedQuery = query.toLowerCase();
  return candidates
    .filter((candidate) => completionRank(candidate.toLowerCase(), normalizedQuery) < Number.POSITIVE_INFINITY)
    .sort((left, right) => completionRank(left.toLowerCase(), normalizedQuery) - completionRank(right.toLowerCase(), normalizedQuery))
    .slice(0, limit);
}

function completionRank(value: string, query: string): number {
  if (!query) {
    return 0;
  }
  if (value === query) {
    return 0;
  }
  if (value.startsWith(query)) {
    return 1;
  }
  const slashless = value.startsWith("/") ? value.slice(1) : value;
  const basename = slashless.split("/").at(-1) ?? slashless;
  if (slashless === query) {
    return 2;
  }
  if (slashless.startsWith(query)) {
    return 3;
  }
  if (basename === query) {
    return 4;
  }
  if (basename.startsWith(query)) {
    return 5;
  }
  const basenameIndex = basename.indexOf(query);
  if (basenameIndex >= 0) {
    return 10 + basenameIndex;
  }
  const index = value.indexOf(query);
  if (index >= 0) {
    return 30 + index;
  }
  if (fuzzyMatch(value, query)) {
    return 100 + value.length;
  }
  return Number.POSITIVE_INFINITY;
}

function isPromptEditingMode(mode: Mode): boolean {
  return mode === "chat" || mode === "command" || mode === "file-completion" || mode === "skill-completion";
}

function isDetailToggleKey(input: string, key: Record<string, unknown>): boolean {
  return input === "\u001b[24~" || key.f12 === true;
}

export async function listWorkspaceFiles(workspacePath: string): Promise<string[]> {
  const normalizeFiles = (stdout: string) =>
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\.\//, ""))
      .filter((line) => !line.startsWith(".git/"))
      .slice(0, 1000);

  try {
    const { stdout } = await execFileAsync("rg", ["--files"], { cwd: workspacePath });
    const files = normalizeFiles(stdout);
    if (files.length > 0) {
      return files;
    }
  } catch {
    // Fall through to find/Node scanning. TUI environments can have a different PATH.
  }

  try {
    const { stdout } = await execFileAsync("find", [".", "-type", "f", "-not", "-path", "./.git/*"], { cwd: workspacePath });
    const files = normalizeFiles(stdout);
    if (files.length > 0) {
      return files;
    }
  } catch {
    // Fall through to the dependency-free scanner.
  }

  return listWorkspaceFilesWithNode(workspacePath);
}

function isReturnInput(input: string): boolean {
  return input === "\r" || input === "\n";
}

const ignoredFileCompletionDirs = new Set([".git", "node_modules", ".potato", "dist", "build", "coverage"]);

async function listWorkspaceFilesWithNode(workspacePath: string, maxFiles = 1000): Promise<string[]> {
  const files: string[] = [];
  const pending = [workspacePath];

  while (pending.length > 0 && files.length < maxFiles) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredFileCompletionDirs.has(entry.name)) {
          pending.push(absolutePath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(relative(workspacePath, absolutePath));
        if (files.length >= maxFiles) {
          break;
        }
      }
    }
  }

  return files;
}
