import type { RuntimeCapabilityReport } from "../trace/TraceStore.js";

export class RuntimeCapabilityReporter {
  forAdapter(adapter: RuntimeCapabilityReport["adapter"]): RuntimeCapabilityReport {
    if (adapter === "rpc") {
      return {
        adapter: "rpc",
        systemPrompt: true,
        skills: true,
        mcpServers: false,
        network: "unknown",
        toolAllowDeny: true,
        toolInterception: false,
        toolBoundaryApproval: false,
        notes: [
          "Pi RPC accepts system prompt, appended system prompt, skills, and tool allow/deny through CLI args.",
          "Pi RPC still owns final tool execution, so core ToolBoundary approval is not enforced on this path."
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
