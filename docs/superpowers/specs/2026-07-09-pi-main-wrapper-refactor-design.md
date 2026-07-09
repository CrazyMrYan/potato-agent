# Pi Main Wrapper Refactor Design

## Decision

Potato will be refactored into a thin, non-invasive wrapper around Pi. The default `potato` command will delegate to Pi's public `main(args, { extensionFactories })` entrypoint so Pi owns the agent loop, TUI, print mode, RPC mode, sessions, tools, skills, themes, model selection, compaction, and future runtime behavior.

Potato will stop reimplementing Pi's host experience. Its product surface becomes startup preparation, compatibility checks, optional extension-based enhancements, release packaging, and small helper commands that do not replace Pi behavior.

## Goals

- Use Pi's full public capability surface, including the native Pi TUI.
- Keep Potato upgrades aligned with Pi by depending on public Pi exports instead of raw event shapes or internal files.
- Make all Potato enhancements optional, explicit, and easy to disable.
- Avoid writing into Pi-owned project state by default.
- Preserve a small CLI package that can be published as `@potato/cli`.

## Non-Goals

- Potato will not maintain its own Ink TUI.
- Potato will not translate Pi runtime events into a parallel Potato transcript model.
- Potato will not provide a separate AI SDK runtime path.
- Potato will not replace Pi's system prompt by default.
- Potato will not generate `.pi/agents` or runtime `.ts` extension files unless a user explicitly enables an enhancement that requires generated artifacts.

## Current Problems

The current repository contains several layers that duplicate or depend deeply on Pi implementation details:

- `cli/src/ui/AgentTui.tsx` and `cli/src/ui/PromptEditor.ts` reimplement terminal interaction that Pi already provides.
- `cli/src/ui/EventStreamRenderer.ts`, `core/src/pi/PiEventMapper.ts`, `core/src/session/AgentSession.ts`, and related protocol events create a parallel event model tied to Pi RPC event shapes.
- `core/src/runtime/RuntimeSessionAdapter.ts` and `core/src/runtime/RuntimeTaskAdapter.ts` preserve an alternative runtime direction that conflicts with using Pi as the authoritative runtime.
- `core/src/pi/PotatoPiRuntime.ts` writes generated extensions and subagent files into the workspace by default, which makes Potato more intrusive than the target product boundary.

These layers increase maintenance cost and make Pi upgrades harder because Potato must track UI behavior, event schemas, and runtime semantics that Pi already owns.

## Target Architecture

```text
@potato/cli
  -> parse Potato-owned helper commands
  -> prepare optional Potato enhancement config
  -> call @earendil-works/pi-coding-agent main(args, { extensionFactories })
       -> Pi CLI / TUI / print / RPC / sessions / tools / skills
```

For ordinary agent usage, Potato is a launcher and enhancer. Pi remains the only owner of interactive UI and runtime execution.

## CLI Behavior

The default command:

```bash
potato [...pi args]
```

will call Pi's `main()` with the original arguments after Potato has applied only non-invasive preprocessing. With no arguments, this enters Pi's native TUI.

Pi-owned flags such as `--print`, `--mode rpc`, `--provider`, `--model`, `--tool`, `--extension`, `--skill`, `--theme`, session flags, and future Pi flags should pass through without Potato re-parsing or reinterpreting them.

Potato-owned helper commands should be namespaced and small:

- `potato doctor`: checks the installed Pi version, public exports, package wiring, Node version, and optional Potato enhancement configuration.
- `potato enhancements`: lists available Potato extension factories and whether they are enabled.
- `potato version`: may show both Potato and Pi versions.

Existing helper commands such as `diff` and `trace` should be removed unless they still provide value without depending on a parallel runtime event model. If retained, they must not imply Potato owns the Pi task lifecycle.

## Enhancement Model

Potato enhancements are provided through Pi's public extension API, preferably as in-memory `extensionFactories` passed to `main()`.

Enhancements must follow these rules:

- Disabled by default unless clearly harmless.
- Explicitly configurable through `.potato/config.json`, environment variables, or Potato-owned flags.
- No default writes to `.pi/`.
- No generated runtime files unless the user explicitly enables a feature whose implementation requires files.
- No replacement of Pi's system prompt by default.
- No reliance on Pi internal file paths, undocumented event names, or private package layout.

Initial enhancement candidates:

- Startup diagnostics surfaced before Pi starts.
- Optional managed append prompt for Potato-specific conventions.
- Optional MCP configuration validation before Pi starts.
- Optional extension factories for future non-invasive UI widgets or commands, implemented against Pi's documented extension API.

## Package Structure

The repo can be simplified to:

```text
cli/
  src/cli.ts
  src/pi/launchPi.ts
  src/commands/doctor.ts
  src/enhancements/
  tests/

core/
  optional shared config and doctor utilities only, if still useful

docs/
wiki/
```

`protocol/` should be removed unless a stable external Potato protocol remains necessary. In the Pi Main Wrapper architecture, the current protocol exists mostly to support the old parallel event stream and should not survive by default.

`core/` should shrink substantially. It should not contain AgentLoop, AgentSession, PiEventMapper, AI SDK runtime adapters, or a separate tool boundary unless those are needed for helper commands that do not compete with Pi.

## Deletions And Migrations

Remove or retire:

- `cli/src/ui/AgentTui.tsx`
- `cli/src/ui/PromptEditor.ts`
- old event stream rendering used only by Potato-run agent sessions
- `core/src/loop/AgentLoop.ts`
- `core/src/orchestrator/AgentOrchestrator.ts`
- `core/src/session/AgentSession.ts`
- `core/src/session/AgentSessionFactory.ts`
- `core/src/pi/PiRpcAdapter.ts`
- `core/src/pi/PiSessionAdapter.ts`
- `core/src/pi/PiEventMapper.ts`
- `core/src/runtime/RuntimeSessionAdapter.ts`
- `core/src/runtime/RuntimeTaskAdapter.ts`
- `protocol/` event contracts if no retained helper command requires them

Replace with:

- A small Pi launcher that imports Pi's public `main`.
- A compatibility checker that verifies public Pi exports exist.
- Tests proving pass-through arguments reach Pi unchanged.
- Tests proving Potato helper commands do not call Pi.
- Documentation that states Potato is an enhancer, not a runtime fork.

## Data And Config

`.potato/config.json` becomes Potato-only enhancement configuration. It should not mirror all Pi settings and should not become a second source of truth for provider, model, session, tool, skill, or TUI settings that Pi already owns.

Example shape:

```json
{
  "enhancements": {
    "diagnostics": true,
    "appendPrompt": false
  }
}
```

Pi settings stay in Pi's own configuration and command-line flags.

## Error Handling

If Pi cannot be imported, Potato should report:

- installed Potato version
- expected Pi package name
- missing public export
- installed Pi version if available
- suggested reinstall or upgrade command

If an optional Potato enhancement fails to initialize, the default behavior should be to disable that enhancement and continue into Pi unless the user requested a strict check such as `potato doctor`.

## Testing

Focused tests should cover:

- `potato` with arbitrary Pi args calls the injected Pi `main(args, options)` exactly once.
- Unknown/future Pi flags pass through untouched.
- `potato doctor` runs without invoking Pi's interactive main path.
- Enhancement factories are passed to Pi only when enabled.
- The package build no longer depends on Ink, React, AI SDK runtime adapters, or the old protocol package unless a retained helper command justifies them.
- Release build includes a runtime dependency on `@earendil-works/pi-coding-agent`.

Manual verification should include:

```bash
pnpm build
pnpm test
pnpm --filter @potato/cli dev -- --help
pnpm --filter @potato/cli dev -- --print "hello"
pnpm --filter @potato/cli dev
```

The final command should enter Pi's native TUI.

## Rollout

1. Add the new launcher and doctor command behind tests.
2. Switch `cli/src/cli.ts` to delegate ordinary usage to Pi `main`.
3. Remove old custom TUI/session/runtime/protocol code.
4. Simplify package dependencies and release script.
5. Update README and wiki to describe Potato as a Pi enhancer.
6. Run build, tests, and manual Pi pass-through checks.

## Acceptance Criteria

- Running `potato` enters Pi's native TUI.
- Running Pi-supported flags through `potato` behaves like running them through `pi`.
- Potato no longer owns a custom agent TUI or parallel event transcript.
- Potato enhancements are optional and non-invasive.
- The project no longer includes the AI SDK alternative runtime path.
- Documentation clearly states that Pi owns runtime behavior and Potato owns enhancement/preflight behavior.
- Verification proves the build, tests, and at least one Pi pass-through invocation work.
