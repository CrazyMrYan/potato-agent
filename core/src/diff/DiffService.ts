import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangeSet, FileChangeStatus } from "@coding-agent/protocol";

const execFileAsync = promisify(execFile);

export interface DiffService {
  getChangeSet(workspacePath: string): Promise<ChangeSet>;
}

export class GitDiffService implements DiffService {
  async getChangeSet(workspacePath: string): Promise<ChangeSet> {
    const status = await git(["status", "--porcelain=v1"], workspacePath);
    const files = await Promise.all(
      status
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map(async (line) => {
          const parsed = parseStatusLine(line);
          return {
            path: parsed.path,
            status: parsed.status,
            diff: await getFileDiff(workspacePath, parsed.path)
          };
        })
    );

    return { files: files.sort((left, right) => left.path.localeCompare(right.path)) };
  }
}

async function getFileDiff(workspacePath: string, path: string): Promise<string | undefined> {
  const trackedDiff = await git(["diff", "--", path], workspacePath);
  if (trackedDiff.trim()) {
    return trackedDiff;
  }

  const stagedDiff = await git(["diff", "--cached", "--", path], workspacePath);
  if (stagedDiff.trim()) {
    return stagedDiff;
  }

  return undefined;
}

function parseStatusLine(line: string): { path: string; status: FileChangeStatus } {
  const code = line.slice(0, 2);
  const rawPath = line.slice(3);
  const path = rawPath.includes(" -> ") ? (rawPath.split(" -> ").at(-1) as string) : rawPath;

  if (code.includes("A") || code === "??") {
    return { path, status: "added" };
  }
  if (code.includes("D")) {
    return { path, status: "deleted" };
  }
  if (code.includes("R")) {
    return { path, status: "renamed" };
  }
  return { path, status: "modified" };
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}
