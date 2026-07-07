import type { RuntimeCapabilityReport } from "../trace/TraceStore.js";

export class RuntimeCapabilityReporter {
  forAdapter(adapter: RuntimeCapabilityReport["adapter"]): RuntimeCapabilityReport {
    if (adapter === "rpc") {
      return {
        adapter: "rpc",
        systemPrompt: true,
        skills: true,
        mcpServers: true,
        network: "unknown",
        toolAllowDeny: true,
        toolInterception: true,
        toolBoundaryApproval: true,
        notes: [
          "Pi RPC is the default execution core for built-in coding tools, sessions, skills, and compaction.",
          "Potato injects approval, MCP bridge, and subagent behavior through Pi extensions."
        ]
      };
    }

    if (adapter === "runtime") {
      return {
        adapter,
        systemPrompt: true,
        skills: true,
        mcpServers: true,
        network: "supported",
        toolAllowDeny: true,
        toolInterception: true,
        toolBoundaryApproval: true,
        notes: [
          "Standard runtime target: Vercel AI SDK provider abstraction for model switching and tool calling.",
          "MCP SDK is the standard target for tool discovery and web-search server injection."
        ]
      };
    }

    return {
      adapter,
      systemPrompt: true,
      skills: true,
      mcpServers: true,
      network: "supported",
      toolAllowDeny: true,
      toolInterception: true,
      toolBoundaryApproval: true,
      notes: [
        "SDK target: Model Context Protocol injection path with explicit tool interception.",
        "Use this capability only when the active adapter is sdk, not Pi RPC."
      ]
    };
  }
}
