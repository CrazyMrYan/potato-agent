import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createApprovalExtension } from "./approval.js";
import { createMcpBridgeExtension } from "./mcp.js";
import { createSubagentExtension } from "./subagent.js";
import type { PotatoEnhancementConfig, PotatoEnhancementReportItem } from "./types.js";

export type { PotatoEnhancementConfig, PotatoEnhancementReportItem, PotatoMcpServerConfig, PotatoSubagentConfig } from "./types.js";

export function createPotatoExtensionFactories(config: PotatoEnhancementConfig = {}): ExtensionFactory[] {
  const factories: ExtensionFactory[] = [];
  if (config.approval !== false) {
    factories.push(createApprovalExtension());
  }
  if ((config.mcpServers ?? []).length > 0) {
    factories.push(createMcpBridgeExtension({ servers: config.mcpServers ?? [] }));
  }
  if ((config.subagents ?? []).length > 0) {
    factories.push(createSubagentExtension({ subagents: config.subagents ?? [] }));
  }
  return factories;
}

export function buildEnhancementReport(config: PotatoEnhancementConfig = {}): PotatoEnhancementReportItem[] {
  return [
    {
      id: "approval",
      label: "Write/command approval",
      enabled: config.approval !== false,
      detail: config.approval === false ? "disabled by config" : "enabled by default"
    },
    {
      id: "mcp",
      label: "MCP bridge",
      enabled: (config.mcpServers ?? []).length > 0,
      detail: `${config.mcpServers?.length ?? 0} server(s) configured`
    },
    {
      id: "subagent",
      label: "Potato subagents",
      enabled: (config.subagents ?? []).length > 0,
      detail: `${config.subagents?.length ?? 0} subagent(s) configured`
    }
  ];
}
