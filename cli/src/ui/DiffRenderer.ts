import type { ChangeSet } from "@potato/protocol";
import parseDiff from "parse-diff";

export type RenderedDiffLineKind = "header" | "file" | "hunk" | "add" | "remove" | "context";

export type RenderedDiffLine = {
  kind: RenderedDiffLineKind;
  text: string;
};

export function renderChangeSet(changeSet: ChangeSet): RenderedDiffLine[] {
  if (changeSet.files.length === 0) {
    return [{ kind: "header", text: "No changes." }];
  }

  const lines: RenderedDiffLine[] = [{ kind: "header", text: `diff: ${changeSet.files.length} ${changeSet.files.length === 1 ? "file" : "files"} changed` }];
  for (const file of changeSet.files) {
    lines.push({ kind: "file", text: `${statusPrefix(file.status)} ${file.status} ${file.path}` });
    if (file.diff) {
      lines.push(...renderPatch(file.diff));
    }
  }
  return lines;
}

export function renderChangeSetLines(changeSet: ChangeSet): string[] {
  return renderChangeSet(changeSet).map((line) => line.text);
}

export function renderPatch(patch: string, maxLines = 120): RenderedDiffLine[] {
  const parsedLines = parsePatchWithLibrary(patch);
  const lines = parsedLines.slice(0, maxLines);
  if (parsedLines.length > maxLines) {
    lines.push({ kind: "context", text: `  ... ${parsedLines.length - maxLines} more diff lines` });
  }
  return lines;
}

function parsePatchWithLibrary(patch: string): RenderedDiffLine[] {
  const files = parseDiff(patch);
  if (files.length === 0) {
    return patch.split("\n").filter(Boolean).map(renderFallbackPatchLine);
  }

  return files.flatMap((file) =>
    file.chunks.flatMap((chunk) => [
      { kind: "hunk" as const, text: `  ${chunk.content}` },
      ...chunk.changes.map((change) => {
        if (change.type === "add") {
          return { kind: "add" as const, text: `+ ${change.content.slice(1)}` };
        }
        if (change.type === "del") {
          return { kind: "remove" as const, text: `- ${change.content.slice(1)}` };
        }
        return { kind: "context" as const, text: `  ${change.content}` };
      })
    ])
  );
}

function renderFallbackPatchLine(line: string): RenderedDiffLine {
  if (line.startsWith("+") && !line.startsWith("+++")) return { kind: "add", text: `+ ${line.slice(1)}` };
  if (line.startsWith("-") && !line.startsWith("---")) return { kind: "remove", text: `- ${line.slice(1)}` };
  if (line.startsWith("@@")) return { kind: "hunk", text: `  ${line}` };
  return { kind: "context", text: `  ${line}` };
}

function statusPrefix(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "?";
  }
}
