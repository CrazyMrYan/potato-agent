import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

export function createApprovalExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event, ctx) => {
      if (!MUTATING_TOOLS.has(event.toolName)) return undefined;
      if (!ctx.hasUI) {
        return { block: true, reason: "Manual approval required, but no UI is attached." };
      }

      const confirmed = await ctx.ui.confirm(`Approve ${event.toolName}?`, formatApprovalDetail(event.toolName, event.input, ctx.cwd));
      if (!confirmed) {
        return { block: true, reason: "Rejected by user." };
      }
      return undefined;
    });
  };
}

function formatApprovalDetail(toolName: string, input: unknown, cwd: string): string {
  if (toolName === "write") return formatWritePreview(input, cwd);
  if (toolName === "edit") return formatEditPreview(input, cwd);
  return formatInput(input);
}

function formatWritePreview(input: unknown, cwd: string): string {
  const record = toRecord(input);
  const path = pickString(record, ["path", "file_path", "filePath", "file"]);
  const content = pickString(record, ["content"]);
  if (!path || content === undefined) return formatInput(input);
  const absolutePath = resolvePath(cwd, path);
  const oldContent = existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
  return `File: ${path}\n${simpleUnifiedDiff(path, oldContent, content)}`;
}

function formatEditPreview(input: unknown, cwd: string): string {
  const record = toRecord(input);
  const path = pickString(record, ["path", "file_path", "filePath", "file"]);
  if (!path) return formatInput(input);
  const absolutePath = resolvePath(cwd, path);
  if (!existsSync(absolutePath)) return `File: ${path}\nCannot preview: file does not exist.`;
  const oldContent = readFileSync(absolutePath, "utf8");
  const nextContent = applyEditPreview(oldContent, record);
  if (nextContent === undefined) return formatInput(input);
  return `File: ${path}\n${simpleUnifiedDiff(path, oldContent, nextContent)}`;
}

function applyEditPreview(content: string, input: Record<string, unknown> | undefined): string | undefined {
  const edits = Array.isArray(input?.edits)
    ? input.edits
    : typeof input?.oldText === "string" && typeof input?.newText === "string"
      ? [{ oldText: input.oldText, newText: input.newText }]
      : [];
  let next = content;
  for (const edit of edits) {
    const record = toRecord(edit);
    const oldText = pickString(record, ["oldText", "old_text"]);
    const newText = pickString(record, ["newText", "new_text"]);
    if (oldText === undefined || newText === undefined) return undefined;
    next = next.replace(oldText, newText);
  }
  return next;
}

function simpleUnifiedDiff(path: string, oldContent: string, newContent: string): string {
  if (oldContent === newContent) return "No content changes detected.";
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  const max = Math.max(oldLines.length, newLines.length);
  for (let index = 0; index < max; index++) {
    if (oldLines[index] === newLines[index]) {
      if (oldLines[index] !== undefined && lines.length < 80) lines.push(` ${oldLines[index]}`);
      continue;
    }
    if (oldLines[index] !== undefined) lines.push(`-${oldLines[index]}`);
    if (newLines[index] !== undefined) lines.push(`+${newLines[index]}`);
    if (lines.length >= 80) {
      lines.push("... diff truncated ...");
      break;
    }
  }
  return lines.join("\n");
}

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

function formatInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function pickString(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof record?.[key] === "string") return record[key];
  }
  return undefined;
}
