#!/usr/bin/env node
import { build } from "esbuild";
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(repoRoot, ".release", "npm", "cli");
const distDir = join(releaseDir, "dist");

await rm(releaseDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await build({
  entryPoints: [join(repoRoot, "cli", "src", "cli.ts")],
  outfile: join(distDir, "cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  sourcemap: false,
  banner: {
    js: 'import { createRequire as __codingAgentCreateRequire } from "node:module";const require=__codingAgentCreateRequire(import.meta.url);'
  },
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  external: [
    "@earendil-works/pi-coding-agent"
  ]
});
await chmod(join(distDir, "cli.js"), 0o755);

const cliPackage = JSON.parse(await readFile(join(repoRoot, "cli", "package.json"), "utf8"));
const releasePackage = {
  name: cliPackage.name,
  version: cliPackage.version,
  type: "module",
  description: "Coding Agent CLI",
  bin: {
    agent: "./dist/cli.js"
  },
  files: [
    "dist",
    "README.md"
  ],
  dependencies: pickDependencies(cliPackage.dependencies, [
    "@earendil-works/pi-coding-agent"
  ]),
  engines: {
    node: ">=22"
  }
};

await writeFile(join(releaseDir, "package.json"), `${JSON.stringify(releasePackage, null, 2)}\n`);
await cp(join(repoRoot, "README.md"), join(releaseDir, "README.md"));

console.log(`Built npm CLI package at ${releaseDir}`);

function pickDependencies(dependencies = {}, names) {
  return Object.fromEntries(names.filter((name) => dependencies[name]).map((name) => [name, dependencies[name]]));
}
