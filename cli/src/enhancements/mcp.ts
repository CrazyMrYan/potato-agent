import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Type, type TSchema } from "typebox";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { PotatoMcpServerConfig } from "./types.js";

export type McpClientLike = {
  listTools(): Promise<{ tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
  close(): Promise<void>;
};

export type CreateMcpClient = (server: PotatoMcpServerConfig) => Promise<McpClientLike>;

export type McpBridgeOptions = {
  servers: PotatoMcpServerConfig[];
  createClient?: CreateMcpClient;
};

export function createMcpBridgeExtension(options: McpBridgeOptions): ExtensionFactory {
  return async (pi) => {
    const connections: McpClientLike[] = [];
    for (const server of options.servers) {
      try {
        const client = await (options.createClient ?? createDefaultMcpClient)(server);
        connections.push(client);
        const listed = await client.listTools();
        for (const mcpTool of listed.tools ?? []) {
          const toolName = sanitizeToolName(`${server.name}__${mcpTool.name}`);
          pi.registerTool({
            name: toolName,
            label: toolName,
            description: mcpTool.description ?? `MCP tool ${mcpTool.name} from ${server.name}`,
            parameters: toTypeboxSchema(mcpTool.inputSchema),
            async execute(_toolCallId, params) {
              const result = await client.callTool({ name: mcpTool.name, arguments: toRecord(params) ?? {} });
              return {
                content: [{ type: "text", text: formatMcpResult(result) }],
                details: { server: server.name, tool: mcpTool.name, raw: result }
              };
            }
          });
        }
      } catch (error) {
        pi.on("session_start", (_event, ctx) => {
          ctx.ui.notify(`MCP bridge failed for ${server.name}: ${error instanceof Error ? error.message : String(error)}`, "error");
        });
      }
    }

    pi.on("session_shutdown", async () => {
      await Promise.all(connections.splice(0).map((client) => client.close().catch(() => undefined)));
    });
  };
}

async function createDefaultMcpClient(server: PotatoMcpServerConfig): Promise<McpClientLike> {
  const client = new Client({ name: "potato-pi-mcp-bridge", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: resolveServerEnv(server.env),
    stderr: "pipe"
  });
  await client.connect(transport);
  return client;
}

function resolveServerEnv(config: Record<string, string> | undefined): Record<string, string> {
  if (!config) return process.env as Record<string, string>;
  return Object.fromEntries(Object.entries(config).map(([name, envName]) => [name, process.env[envName] ?? ""]));
}

function toTypeboxSchema(schema: unknown) {
  const record = toRecord(schema);
  if (record?.type === "object") return Type.Unsafe(schema as TSchema);
  return Type.Object({}, { additionalProperties: true });
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function formatMcpResult(result: unknown): string {
  const record = toRecord(result);
  if (record?.structuredContent !== undefined) return JSON.stringify(record.structuredContent, null, 2);
  if (record?.toolResult !== undefined) return typeof record.toolResult === "string" ? record.toolResult : JSON.stringify(record.toolResult, null, 2);
  const content = record?.content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) => toRecord(item))
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item?.text)
      .join("\n");
    if (text) return text;
  }
  return JSON.stringify(result, null, 2);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
