import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PotatoEnhancementConfig, PotatoMcpServerConfig, PotatoSubagentConfig } from "../enhancements/index.js";

export type PotatoConfig = {
  enhancements: PotatoEnhancementConfig;
};

export async function loadPotatoConfig(cwd = process.cwd()): Promise<PotatoEnhancementConfig> {
  const path = join(cwd, ".potato", "config.json");
  try {
    const raw = await readFile(path, "utf8");
    return normalizeEnhancementConfig(JSON.parse(raw));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return defaultEnhancementConfig();
    throw new Error(`Failed to load ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function defaultEnhancementConfig(): PotatoEnhancementConfig {
  return { approval: true };
}

function normalizeEnhancementConfig(value: unknown): PotatoEnhancementConfig {
  const root = toRecord(value);
  const enhancements = toRecord(root?.enhancements) ?? {};
  return {
    approval: typeof enhancements.approval === "boolean" ? enhancements.approval : true,
    mcpServers: normalizeMcpServers(enhancements.mcpServers),
    subagents: normalizeSubagents(enhancements.subagents)
  };
}

function normalizeMcpServers(value: unknown): PotatoMcpServerConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const record = toRecord(item);
    if (typeof record?.name !== "string" || typeof record.command !== "string") return [];
    return [
      {
        name: record.name,
        command: record.command,
        args: stringArray(record.args),
        env: stringRecord(record.env)
      }
    ];
  });
}

function normalizeSubagents(value: unknown): PotatoSubagentConfig[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const record = toRecord(item);
    if (typeof record?.id !== "string" || typeof record.description !== "string" || typeof record.systemPrompt !== "string") return [];
    return [
      {
        id: record.id,
        description: record.description,
        systemPrompt: record.systemPrompt,
        tools: stringArray(record.tools)
      }
    ];
  });
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = toRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
