import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDefaultWorkspacePath } from "../src/config/Workspace.js";

describe("resolveDefaultWorkspacePath", () => {
  it("walks up from nested dist folders to the git workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-workspace-"));
    const nested = join(root, "cli", "dist");

    try {
      await mkdir(join(root, ".git"), { recursive: true });
      await mkdir(nested, { recursive: true });
      await writeFile(join(root, "package.json"), "{}", "utf8");

      await expect(resolveDefaultWorkspacePath(nested)).resolves.toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to cwd when no git workspace exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-workspace-no-git-"));

    try {
      await expect(resolveDefaultWorkspacePath(root)).resolves.toBe(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
