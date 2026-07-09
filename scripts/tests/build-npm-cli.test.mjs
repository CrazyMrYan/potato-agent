import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "./helpers.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("npm cli release inherits runtime dependencies from cli package", async () => {
  await execa(process.execPath, [join(repoRoot, "scripts", "build-npm-cli.mjs")], { cwd: repoRoot });

  const cliPackage = JSON.parse(await readFile(join(repoRoot, "cli", "package.json"), "utf8"));
  const releasePackage = JSON.parse(await readFile(join(repoRoot, ".release", "npm", "cli", "package.json"), "utf8"));

  assert.equal(
    releasePackage.dependencies["@earendil-works/pi-coding-agent"],
    cliPackage.dependencies["@earendil-works/pi-coding-agent"]
  );
  assert.equal(releasePackage.dependencies["@potato/core"], undefined);
  assert.equal(releasePackage.dependencies["@potato/protocol"], undefined);
});
