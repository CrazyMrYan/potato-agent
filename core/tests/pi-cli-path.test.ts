import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolvePiCliPath } from "../src/pi/resolvePiCliPath.js";

describe("Pi CLI path resolution", () => {
  it("resolves the installed Pi CLI entrypoint", () => {
    const cliPath = resolvePiCliPath();

    expect(cliPath).toMatch(/@earendil-works\/pi-coding-agent\/dist\/cli\.js$/);
    expect(existsSync(cliPath)).toBe(true);
  });
});
