import type { RuntimeCapabilityReport } from "../trace/TraceStore.js";

export class RuntimeCapabilityReporter {
  forAdapter(adapter: RuntimeCapabilityReport["adapter"]): RuntimeCapabilityReport {
    if (adapter === "rpc") {
      return {
        adapter: "rpc",
        systemPrompt: true,
        skills: true,
        mcpServers: false,
        toolAllowDeny: true,
        toolInterception: false,
        toolBoundaryApproval: false,
        notes: [
          "Pi RPC accepts system prompt, appended system prompt, skills, and tool allow/deny through CLI args.",
          "Pi RPC still owns final tool execution, so core ToolBoundary approval is not enforced on this path."
        ]
      };
    }

    return {
      adapter,
      systemPrompt: false,
      skills: false,
      mcpServers: false,
      toolAllowDeny: false,
      toolInterception: false,
      toolBoundaryApproval: false,
      notes: [`${adapter} adapter is experimental until SDK/runtime tool interception is implemented.`]
    };
  }
}
