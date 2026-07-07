import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { jsonSchema, tool, type ToolSet } from "ai";
import type { AgentMcpServerConfig } from "../config/AgentConfig.js";

type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
    [key: string]: unknown;
  };
};

type McpConnection = {
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<McpToolResult>;
  close(): Promise<void>;
};

type McpToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  toolResult?: unknown;
  [key: string]: unknown;
};

type McpClient = {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<McpToolResult>;
  close(): Promise<void>;
};

export type McpToolRegistryDependencies = {
  connect?: (server: AgentMcpServerConfig) => Promise<McpConnection>;
  createClient?: () => McpClient;
  createStdioTransport?: (options: StdioTransportOptions) => unknown;
  env?: NodeJS.ProcessEnv;
};

type StdioTransportOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  stderr: "pipe";
};

export class McpToolRegistry {
  private readonly connections: McpConnection[] = [];

  constructor(
    private readonly servers: AgentMcpServerConfig[] = [],
    private readonly dependencies: McpToolRegistryDependencies = {}
  ) {}

  async loadTools(): Promise<ToolSet> {
    const tools: ToolSet = {};
    for (const server of this.servers) {
      const connection = await (this.dependencies.connect
        ? this.dependencies.connect(server)
        : connectStdioServer(server, this.dependencies));
      this.connections.push(connection);
      const listed = await connection.listTools();
      for (const mcpTool of listed.tools) {
        tools[`${server.name}__${mcpTool.name}`] = tool({
          description: mcpTool.description,
          inputSchema: jsonSchema(mcpTool.inputSchema),
          execute: async (input) => formatMcpToolResult(await connection.callTool({ name: mcpTool.name, arguments: toRecord(input) }))
        });
      }
    }
    return tools;
  }

  async close(): Promise<void> {
    await Promise.all(this.connections.splice(0).map((connection) => connection.close()));
  }
}

async function connectStdioServer(server: AgentMcpServerConfig, dependencies: McpToolRegistryDependencies = {}): Promise<McpConnection> {
  const client: McpClient = dependencies.createClient?.() ?? new Client({ name: "potato", version: "0.1.0" });
  const transportOptions: StdioTransportOptions = {
    command: server.command,
    args: server.args,
    env: resolveServerEnv(server.env, dependencies.env ?? process.env),
    stderr: "pipe"
  };
  const transport = dependencies.createStdioTransport?.(transportOptions) ?? new StdioClientTransport(transportOptions);
  await client.connect(transport);
  return {
    listTools: () => client.listTools(),
    callTool: (params) => client.callTool(params),
    close: () => client.close()
  };
}

function formatMcpToolResult(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  if ("toolResult" in result) {
    return result.toolResult;
  }
  const text = result.content
    ?.filter((item) => item.type === "text" && item.text)
    .map((item) => item.text)
    .join("\n");
  return text || result;
}

function toRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function resolveServerEnv(config: Record<string, string> | undefined, env: NodeJS.ProcessEnv): Record<string, string> | undefined {
  if (!config) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(config).map(([name, envName]) => [name, env[envName] ?? ""]));
}
