import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { GitDiffService } from "../src/diff/DiffService.js";

const execFileAsync = promisify(execFile);

describe("GitDiffService", () => {
  it("returns an empty changeset for a clean repository", async () => {
    const workspace = await initRepo();
    try {
      const service = new GitDiffService();
      await expect(service.getChangeSet(workspace)).resolves.toEqual({ files: [] });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("maps modified, added, and deleted files into a changeset", async () => {
    const workspace = await initRepo();
    try {
      await writeFile(join(workspace, "tracked.txt"), "changed\n", "utf8");
      await writeFile(join(workspace, "added.txt"), "new\n", "utf8");
      await rm(join(workspace, "deleted.txt"));

      const changeSet = await new GitDiffService().getChangeSet(workspace);

      expect(changeSet.files.map((file) => [file.path, file.status])).toEqual([
        ["added.txt", "added"],
        ["deleted.txt", "deleted"],
        ["tracked.txt", "modified"]
      ]);
      expect(changeSet.files.find((file) => file.path === "tracked.txt")?.diff).toContain("-initial");
      expect(changeSet.files.find((file) => file.path === "tracked.txt")?.diff).toContain("+changed");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

async function initRepo(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "coding-agent-diff-"));
  await execFileAsync("git", ["init"], { cwd: workspace });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: workspace });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: workspace });
  await writeFile(join(workspace, "tracked.txt"), "initial\n", "utf8");
  await writeFile(join(workspace, "deleted.txt"), "delete me\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: workspace });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: workspace });
  return workspace;
}
