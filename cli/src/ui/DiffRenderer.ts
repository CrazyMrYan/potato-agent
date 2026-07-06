import type { ChangeSet } from "@potato/protocol";

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
    lines.push({ kind: "file", text: `${file.status} ${file.path}` });
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
  const rawLines = patch.split("\n").filter((line) => line.length > 0);
  const lines = rawLines.slice(0, maxLines).map(renderPatchLine);
  if (rawLines.length > maxLines) {
    lines.push({ kind: "context", text: `  ... ${rawLines.length - maxLines} more diff lines` });
  }
  return lines;
}

function renderPatchLine(line: string): RenderedDiffLine {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return { kind: "add", text: `+ ${line.slice(1)}` };
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return { kind: "remove", text: `- ${line.slice(1)}` };
  }
  if (line.startsWith("@@")) {
    return { kind: "hunk", text: `  ${line}` };
  }
  return { kind: "context", text: `  ${line}` };
}
