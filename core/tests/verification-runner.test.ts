import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VerificationRunner } from "../src/verification/VerificationRunner.js";

describe("VerificationRunner", () => {
  it("runs an explicit verification command", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "potato-verify-"));
    const runner = new VerificationRunner({
      execFile: async (file, args) => ({
        exitCode: 0,
        output: `${file} ${args.join(" ")}`
      })
    });

    await expect(runner.run({ workspacePath: workspace, command: "pnpm test" })).resolves.toEqual({
      command: "pnpm test",
      exitCode: 0,
      output: "pnpm test"
    });
  });

  it("detects pnpm test from package.json scripts", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "potato-verify-"));
    await writeFile(join(workspace, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }), "utf8");
    const runner = new VerificationRunner({
      execFile: async (file, args) => ({ exitCode: 0, output: `${file} ${args.join(" ")}` })
    });

    await expect(runner.detect(workspace)).resolves.toBe("pnpm test");
  });
});
