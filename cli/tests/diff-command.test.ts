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

    expect(write).toHaveBeenCalledWith("diff: 1 file changed");
    expect(write).toHaveBeenCalledWith("modified src/a.ts");
    expect(write).toHaveBeenCalledWith("  patch");
  });

  it("renders unified diff lines with stable prefixes", async () => {
    const write = vi.fn();

    await diffCommand({
      workspacePath: "/repo",
      write,
      diffService: {
        async getChangeSet() {
          return {
            files: [
              {
                path: "src/a.ts",
                status: "modified",
                diff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new"
              }
            ]
          };
        }
      }
    });

    expect(write.mock.calls.map((call) => call[0])).toEqual([
      "diff: 1 file changed",
      "modified src/a.ts",
      "  diff --git a/src/a.ts b/src/a.ts",
      "  @@ -1 +1 @@",
      "- old",
      "+ new"
    ]);
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
