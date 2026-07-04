import { describe, expect, it, vi } from "vitest";
import { diffCommand } from "../src/commands/diff.js";

describe("diff command", () => {
  it("prints changed files", async () => {
    const write = vi.fn();

    await diffCommand({
      workspacePath: "/repo",
      write,
      diffService: {
        async getChangeSet() {
          return { files: [{ path: "src/a.ts", status: "modified", diff: "patch" }] };
        }
      }
    });

    expect(write).toHaveBeenCalledWith("modified src/a.ts");
    expect(write).toHaveBeenCalledWith("patch");
  });

  it("resolves the default workspace before reading diff", async () => {
    const write = vi.fn();
    const seen: string[] = [];

    await diffCommand({
      cwd: "/repo/cli",
      write,
      resolveWorkspacePath: async (cwd) => {
        seen.push(cwd);
        return "/repo";
      },
      diffService: {
        async getChangeSet(workspacePath) {
          seen.push(workspacePath);
          return { files: [] };
        }
      }
    });

    expect(seen).toEqual(["/repo/cli", "/repo"]);
  });
});
