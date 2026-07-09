# Pi Main Wrapper Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Potato into a thin wrapper that delegates ordinary usage to Pi's public `main(args, { extensionFactories })` entrypoint and removes Potato-owned agent runtime/TUI duplication.

**Architecture:** `@potato/cli` becomes the only runtime package. It routes Potato-owned helper commands such as `doctor`, otherwise passes all args through to Pi. Optional Potato enhancements are built as in-memory extension factories and passed to Pi only when enabled; Pi owns TUI, print mode, RPC mode, sessions, tools, skills, and agent execution.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, Commander-free or minimal CLI dispatch, `@earendil-works/pi-coding-agent` public exports.

---

## File Structure

- Create `cli/src/pi/launchPi.ts`: small wrapper around Pi `main`, dependency-injectable for tests.
- Create `cli/src/commands/doctor.ts`: non-interactive compatibility checks for Pi package exports and environment.
- Create `cli/src/enhancements/index.ts`: returns enabled Potato extension factories; initially empty unless config enables future additions.
- Replace `cli/src/cli.ts`: lightweight dispatcher for `doctor`, `enhancements`, `version`, and Pi pass-through.
- Rewrite `cli/tests/cli.test.ts`: tests pass-through routing and helper command routing.
- Add `cli/tests/doctor-command.test.ts`: tests doctor diagnostics without launching Pi.
- Remove old CLI command/UI files once pass-through is green.
- Remove or shrink `core/` and `protocol/` after no package imports them.
- Update `package.json`, `cli/package.json`, `pnpm-workspace.yaml`, `scripts/build-npm-cli.mjs`, README, and wiki docs to match the wrapper architecture.

## Task 1: Add Pi Launcher

**Files:**
- Create: `cli/src/pi/launchPi.ts`
- Test: `cli/tests/launch-pi.test.ts`

- [ ] **Step 1: Write the failing launcher tests**

Create `cli/tests/launch-pi.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { launchPi } from "../src/pi/launchPi.js";

describe("launchPi", () => {
  it("passes args and extension factories to Pi main", async () => {
    const main = vi.fn(async () => undefined);
    const extensionFactories = [() => undefined];

    await launchPi(["--print", "hello"], {
      main,
      extensionFactories
    });

    expect(main).toHaveBeenCalledTimes(1);
    expect(main).toHaveBeenCalledWith(["--print", "hello"], { extensionFactories });
  });

  it("uses an empty extension factory list by default", async () => {
    const main = vi.fn(async () => undefined);

    await launchPi(["--help"], { main });

    expect(main).toHaveBeenCalledWith(["--help"], { extensionFactories: [] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @potato/cli test -- launch-pi.test.ts`

Expected: FAIL because `cli/src/pi/launchPi.ts` does not exist.

- [ ] **Step 3: Implement the launcher**

Create `cli/src/pi/launchPi.ts`:

```ts
import { main as piMain, type ExtensionFactory } from "@earendil-works/pi-coding-agent";

export type PiMain = (args: string[], options?: { extensionFactories?: ExtensionFactory[] }) => Promise<void>;

export type LaunchPiOptions = {
  main?: PiMain;
  extensionFactories?: ExtensionFactory[];
};

export async function launchPi(args: string[], options: LaunchPiOptions = {}): Promise<void> {
  const main = options.main ?? piMain;
  await main(args, {
    extensionFactories: options.extensionFactories ?? []
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @potato/cli test -- launch-pi.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/pi/launchPi.ts cli/tests/launch-pi.test.ts
git commit -m "feat: add pi main launcher"
```

## Task 2: Add Doctor Command

**Files:**
- Create: `cli/src/commands/doctor.ts`
- Test: `cli/tests/doctor-command.test.ts`

- [ ] **Step 1: Write failing doctor tests**

Create `cli/tests/doctor-command.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runDoctor, type DoctorCheck } from "../src/commands/doctor.js";

describe("runDoctor", () => {
  it("reports all checks as ok when Pi exports are available", async () => {
    const checks: DoctorCheck[] = [
      { name: "node", run: async () => ({ ok: true, message: "Node OK" }) },
      { name: "pi-main", run: async () => ({ ok: true, message: "Pi main OK" }) }
    ];
    const lines: string[] = [];

    const exitCode = await runDoctor({ checks, write: (line) => lines.push(line) });

    expect(exitCode).toBe(0);
    expect(lines).toEqual(["OK node - Node OK", "OK pi-main - Pi main OK"]);
  });

  it("returns non-zero when any check fails", async () => {
    const checks: DoctorCheck[] = [
      { name: "pi-main", run: async () => ({ ok: false, message: "Missing Pi main export" }) }
    ];
    const lines: string[] = [];

    const exitCode = await runDoctor({ checks, write: (line) => lines.push(line) });

    expect(exitCode).toBe(1);
    expect(lines).toEqual(["FAIL pi-main - Missing Pi main export"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @potato/cli test -- doctor-command.test.ts`

Expected: FAIL because `runDoctor` does not exist.

- [ ] **Step 3: Implement doctor**

Create `cli/src/commands/doctor.ts`:

```ts
import { main } from "@earendil-works/pi-coding-agent";

export type DoctorResult = {
  ok: boolean;
  message: string;
};

export type DoctorCheck = {
  name: string;
  run(): Promise<DoctorResult>;
};

export type DoctorOptions = {
  checks?: DoctorCheck[];
  write?: (line: string) => void;
};

export async function runDoctor(options: DoctorOptions = {}): Promise<number> {
  const checks = options.checks ?? defaultDoctorChecks();
  const write = options.write ?? console.log;
  let ok = true;

  for (const check of checks) {
    const result = await check.run();
    ok &&= result.ok;
    write(`${result.ok ? "OK" : "FAIL"} ${check.name} - ${result.message}`);
  }

  return ok ? 0 : 1;
}

export function defaultDoctorChecks(): DoctorCheck[] {
  return [
    {
      name: "node",
      async run() {
        const major = Number.parseInt(process.versions.node.split(".", 1)[0] ?? "0", 10);
        return major >= 22
          ? { ok: true, message: `Node ${process.versions.node}` }
          : { ok: false, message: `Node ${process.versions.node}; Pi requires Node >=22.19.0` };
      }
    },
    {
      name: "pi-main",
      async run() {
        return typeof main === "function"
          ? { ok: true, message: "@earendil-works/pi-coding-agent main export available" }
          : { ok: false, message: "@earendil-works/pi-coding-agent main export missing" };
      }
    }
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @potato/cli test -- doctor-command.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/doctor.ts cli/tests/doctor-command.test.ts
git commit -m "feat: add potato doctor command"
```

## Task 3: Replace CLI Entry With Pi Pass-Through

**Files:**
- Modify: `cli/src/cli.ts`
- Test: `cli/tests/cli.test.ts`

- [ ] **Step 1: Write failing CLI routing tests**

Create `cli/tests/cli.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

describe("runCli", () => {
  it("delegates unknown and Pi-owned args to Pi unchanged", async () => {
    const launchPi = vi.fn(async () => undefined);

    await runCli(["--print", "hello", "--future-pi-flag"], {
      launchPi,
      runDoctor: async () => 0,
      write: () => undefined
    });

    expect(launchPi).toHaveBeenCalledWith(["--print", "hello", "--future-pi-flag"]);
  });

  it("runs potato doctor without launching Pi", async () => {
    const launchPi = vi.fn(async () => undefined);
    const runDoctor = vi.fn(async () => 0);

    await runCli(["doctor"], {
      launchPi,
      runDoctor,
      write: () => undefined
    });

    expect(runDoctor).toHaveBeenCalledTimes(1);
    expect(launchPi).not.toHaveBeenCalled();
  });

  it("prints enhancement status without launching Pi", async () => {
    const lines: string[] = [];
    const launchPi = vi.fn(async () => undefined);

    await runCli(["enhancements"], {
      launchPi,
      runDoctor: async () => 0,
      write: (line) => lines.push(line)
    });

    expect(lines).toEqual(["No Potato enhancements are enabled."]);
    expect(launchPi).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @potato/cli test -- cli.test.ts`

Expected: FAIL because current `cli.ts` does not export `runCli` and uses Commander commands.

- [ ] **Step 3: Replace `cli/src/cli.ts`**

Replace `cli/src/cli.ts` with:

```ts
#!/usr/bin/env node
import { runDoctor } from "./commands/doctor.js";
import { launchPi } from "./pi/launchPi.js";

export type RunCliDependencies = {
  launchPi?: (args: string[]) => Promise<void>;
  runDoctor?: () => Promise<number>;
  write?: (line: string) => void;
};

export async function runCli(args: string[], dependencies: RunCliDependencies = {}): Promise<number> {
  const [command, ...rest] = args;
  const write = dependencies.write ?? console.log;

  if (command === "doctor") {
    return dependencies.runDoctor ? dependencies.runDoctor() : runDoctor();
  }

  if (command === "enhancements") {
    write("No Potato enhancements are enabled.");
    return 0;
  }

  if (command === "version") {
    write("potato 0.1.0");
    return 0;
  }

  const delegate = dependencies.launchPi ?? launchPi;
  await delegate(command === undefined ? [] : [command, ...rest]);
  return 0;
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isDirectRun) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
```

- [ ] **Step 4: Run the CLI routing tests**

Run: `pnpm --filter @potato/cli test -- cli.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/src/cli.ts cli/tests/cli.test.ts
git commit -m "feat: delegate potato cli to pi main"
```

## Task 4: Remove Old CLI Commands And UI

**Files:**
- Delete: `cli/src/commands/chat.ts`
- Delete: `cli/src/commands/run.ts`
- Delete: `cli/src/commands/tui.tsx`
- Delete: `cli/src/ui/AgentTui.tsx`
- Delete: `cli/src/ui/PromptEditor.ts`
- Delete: `cli/src/ui/EventStreamRenderer.ts`
- Delete old tests that target deleted behavior
- Keep or delete `cli/src/commands/diff.ts`, `cli/src/commands/trace.ts`, `cli/src/ui/DiffRenderer.ts`, `cli/src/ui/MarkdownRenderer.ts` based on import graph after Task 3.

- [ ] **Step 1: Confirm old modules are not imported by new CLI**

Run: `rg -n "commands/(chat|run|tui)|AgentTui|PromptEditor|EventStreamRenderer" cli/src cli/tests`

Expected: Only old files/tests reference these names.

- [ ] **Step 2: Delete old UI/session command files and tests**

Delete the files that only support Potato-owned agent sessions:

```bash
rm cli/src/commands/chat.ts \
  cli/src/commands/run.ts \
  cli/src/commands/tui.tsx \
  cli/src/ui/AgentTui.tsx \
  cli/src/ui/PromptEditor.ts \
  cli/src/ui/EventStreamRenderer.ts \
  cli/tests/chat-command.test.ts \
  cli/tests/prompt-editor.test.ts \
  cli/tests/run-config.test.ts \
  cli/tests/stream-renderer.test.ts \
  cli/tests/tui-command.test.ts \
  cli/tests/tui-render.test.ts
```

- [ ] **Step 3: Run CLI tests**

Run: `pnpm --filter @potato/cli test`

Expected: PASS or compile errors only for remaining imports of deleted modules.

- [ ] **Step 4: Remove remaining stale imports**

If Step 3 reports imports of deleted modules, remove the importing files if they only test old runtime behavior. If `diff` or `trace` depends on old protocol/runtime types, delete those commands and tests as well:

```bash
rm -f cli/src/commands/diff.ts cli/src/commands/trace.ts cli/src/ui/DiffRenderer.ts cli/src/ui/MarkdownRenderer.ts
rm -f cli/tests/diff-command.test.ts cli/tests/diff-renderer.test.ts cli/tests/trace-command.test.ts
```

- [ ] **Step 5: Run CLI tests again**

Run: `pnpm --filter @potato/cli test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src cli/tests
git commit -m "refactor: remove potato-owned tui commands"
```

## Task 5: Remove Core Runtime And Protocol Packages

**Files:**
- Delete old `core/src` runtime files
- Delete `core/tests`
- Delete `protocol/`
- Modify: `pnpm-workspace.yaml`
- Modify: root `package.json`
- Modify: `cli/package.json`
- Modify: `scripts/build-npm-cli.mjs`

- [ ] **Step 1: Check workspace imports**

Run: `rg -n "@potato/(core|protocol)|from \"@potato|from '@potato" . --glob '!node_modules' --glob '!docs/superpowers/specs/**' --glob '!docs/superpowers/plans/**'`

Expected: Imports remain only in old files slated for deletion or package metadata.

- [ ] **Step 2: Remove workspace packages**

Delete `core/` and `protocol/` after confirming no retained CLI code imports them:

```bash
rm -rf core protocol
```

- [ ] **Step 3: Update workspace package list**

Replace `pnpm-workspace.yaml` with:

```yaml
packages:
  - "cli"
```

- [ ] **Step 4: Update root package scripts**

Replace root `package.json` scripts with package-level commands that only build/test CLI:

```json
{
  "name": "potato",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "pnpm --filter @potato/cli build",
    "build:npm:cli": "node scripts/build-npm-cli.mjs",
    "dev": "pnpm --filter @potato/cli dev",
    "test": "pnpm --filter @potato/cli test",
    "typecheck": "pnpm --filter @potato/cli typecheck"
  },
  "packageManager": "pnpm@10.13.1",
  "devDependencies": {
    "@types/node": "^26.1.0",
    "esbuild": "0.28.1",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 5: Update CLI dependencies**

Edit `cli/package.json` so dependencies include Pi directly and remove old UI/runtime dependencies:

```json
{
  "name": "@potato/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "potato": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^0.80.3"
  },
  "devDependencies": {
    "@types/node": "^26.1.0",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 6: Update release script package assumptions**

Modify `scripts/build-npm-cli.mjs` so it no longer reads `core/package.json`. It should bundle `cli/src/cli.ts`, externalize `@earendil-works/pi-coding-agent`, and copy `cli/package.json` with its direct Pi dependency into `.release/npm/cli`.

- [ ] **Step 7: Install and run tests**

Run:

```bash
pnpm install
pnpm test
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml cli/package.json scripts/build-npm-cli.mjs core protocol
git commit -m "refactor: remove legacy core runtime packages"
```

## Task 6: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `POTATO.md`
- Modify: `wiki/architecture.md`
- Modify: `wiki/technical-design.md`
- Modify: `wiki/project-state.md`
- Modify: `wiki/memo.md`
- Modify: `wiki/technical-plan-mvp.md`

- [ ] **Step 1: Update README**

Rewrite README to state:

```md
# potato

Potato is a non-invasive enhancer for Pi.

The default `potato` command delegates to Pi's public CLI entrypoint, so Pi owns the TUI, runtime, sessions, tools, skills, and agent behavior. Potato adds compatibility checks, packaging, and optional extension-based enhancements without replacing Pi internals.

## Usage

```bash
potato
potato --print "explain this repository"
potato doctor
potato enhancements
```

## Architecture

Potato calls `@earendil-works/pi-coding-agent` through its public `main(args, { extensionFactories })` export. Unknown and future Pi flags pass through unchanged.
```
```

- [ ] **Step 2: Update wiki docs**

Update wiki docs to remove claims that Potato owns AgentLoop, AgentSession, PiEventMapper, MCP bridge runtime, or custom TUI. Replace them with:

```md
Current execution path:

@potato/cli -> Pi public main() -> Pi CLI/TUI/runtime

Potato-owned code is limited to launcher behavior, doctor checks, release packaging, and optional extension factories.
```

- [ ] **Step 3: Search for stale architecture claims**

Run:

```bash
rg -n "AgentLoop|AgentSession|PiEventMapper|RuntimeSessionAdapter|RuntimeTaskAdapter|AgentTui|PromptEditor|EventStreamRenderer|Vercel AI SDK|Tool Boundary|Pi RPC -> Pi|cli -> core" README.md POTATO.md wiki docs
```

Expected: Matches remain only in historical plan/spec files or explicit migration notes, not current-state docs.

- [ ] **Step 4: Commit docs**

```bash
git add README.md POTATO.md wiki docs
git commit -m "docs: describe potato as pi wrapper"
```

## Task 7: Release Build Verification

**Files:**
- Modify if needed: `scripts/build-npm-cli.mjs`
- Test command only otherwise

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm build
pnpm test
pnpm typecheck
pnpm build:npm:cli
```

Expected: all commands exit 0.

- [ ] **Step 2: Verify pass-through help**

Run:

```bash
pnpm --filter @potato/cli dev -- --help
```

Expected: Pi help output appears, proving `potato --help` delegates to Pi.

- [ ] **Step 3: Verify doctor does not launch Pi**

Run:

```bash
pnpm --filter @potato/cli dev -- doctor
```

Expected: outputs `OK node` and `OK pi-main` lines and exits 0.

- [ ] **Step 4: Verify release package metadata**

Run:

```bash
node -e "const p=require('./.release/npm/cli/package.json'); console.log(p.dependencies)"
```

Expected: prints an object containing `@earendil-works/pi-coding-agent`.

- [ ] **Step 5: Commit verification fixes if needed**

If any release-script changes were required:

```bash
git add scripts/build-npm-cli.mjs .release/npm/cli/package.json
git commit -m "fix: align cli release package with pi wrapper"
```

If no code changed, do not create an empty commit.
