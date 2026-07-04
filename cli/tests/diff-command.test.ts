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
});
