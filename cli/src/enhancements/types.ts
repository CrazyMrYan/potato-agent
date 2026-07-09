import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export type PotatoMcpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type PotatoSubagentConfig = {
  id: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
};

export type PotatoEnhancementConfig = {
  approval?: boolean;
  mcpServers?: PotatoMcpServerConfig[];
  subagents?: PotatoSubagentConfig[];
};

export type PotatoEnhancementReportItem = {
  id: "approval" | "mcp" | "subagent";
  label: string;
  enabled: boolean;
  detail: string;
};

export type PotatoExtensionFactory = ExtensionFactory;
