# M5 Core Trace, Diff, and Runtime Permissions Design

## Context

The project has completed the M4 CLI/TUI and core runtime configuration work. The next stage should focus on capabilities that make a coding potato trustworthy in real repositories:

- the user can understand what happened;
- the product can replay and debug a task;
- changed files and diffs are visible;
- tool access is governed by project-owned policy, not hidden inside the underlying potato engine.

The current default execution path is `AgentGateway -> AgentOrchestrator -> PiRpcAdapter -> Pi RPC subprocess`. This path is useful and should remain available. Its limitation is that Pi RPC still owns the real tool execution boundary. M5 should therefore add product-owned trace/diff capabilities on the stable path, while adding a switchable SDK/runtime permission path that proves whether tool calls can be intercepted by `core/`.

## Core Function List

The coding agent's core capabilities, in priority order, are:

1. Agent execution loop: accept a task, invoke the underlying potato engine, and emit stable events.
2. Multi-turn session: keep one session alive across multiple prompts.
3. Observable event stream: expose assistant text, thinking, tool starts, tool finishes, failure, and completion.
4. Runtime configuration: centralize provider, model, API key, system prompt, skills, MCP server descriptions, tool allow/deny, and permission policy in `core/`.
5. Trace recording: persist task input, event stream, tool activity, final state, and errors for replay and debugging.
6. Diff generation: produce a `ChangeSet` from Git after a task and expose it through events and CLI.
7. Permission and tool boundary: apply product-owned allow/confirm/deny decisions for local tools.
8. Verification strategy: record and display test/build command execution.
9. CLI/TUI shell: provide task input, session input, runtime configuration, and readable progress.
10. Runtime/SDK adapter: provide an execution path where `core/` can own MCP and tool permission decisions.

## M5 Scope

M5 implements three production capabilities and one aggressive validation path:

1. `JsonlTraceStore` in `core/`.
2. Git-backed `DiffService` in `core/`.
3. CLI commands `potato trace` and `potato diff`.
4. A switchable runtime/SDK permission path that attempts to route tool calls through `ToolBoundary`.

The default `PiRpcAdapter` remains available. M5 must not claim full permission control for the RPC path unless the implementation can prove that `core/` is making the final tool decision.

## Non-Goals

- Do not build a desktop UI.
- Do not replace the TUI as part of M5.
- Do not implement a full custom agent loop from scratch.
- Do not make MCP server execution a user-facing feature unless the runtime/SDK path proves it can be controlled by `core/`.
- Do not remove `PiRpcAdapter` until another path is equally usable.

## Architecture

```text
CLI/TUI
  -> AgentGateway
  -> AgentOrchestrator
      -> TraceStore
      -> DiffService
      -> ToolBoundary
      -> PiRpcAdapter
      -> PiSdkAdapter or RuntimePiAdapter
```

`AgentOrchestrator` becomes the point where trace and diff are consistently applied. Adapter implementations should only translate between the project model and the underlying execution engine.

### Trace Store

`TraceStore` records append-only JSONL entries under:

```text
<workspace>/.potato/traces/<taskId>.jsonl
```

Each entry includes:

- `timestamp`
- `taskId`
- `kind`
- payload

Initial entry kinds:

- `task.input`
- `event`
- `diff`
- `task.finished`
- `task.failed`
- `runtime.capability`

Trace records should use the existing protocol events where possible. This avoids inventing a second event model.

### Diff Service

`DiffService` shells out to Git from the workspace root and returns the existing protocol `ChangeSet`:

```ts
type ChangeSet = {
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed";
    diff?: string;
  }>;
};
```

M5 should support:

- modified files;
- added files;
- deleted files;
- renamed files when Git reports them;
- empty diff as a valid result.

The orchestrator emits `diff.produced` after adapter execution completes. If diff generation fails, the task should not be marked failed by default; instead, trace the diff error and emit a warning-like trace record. The current protocol does not have a warning event, so CLI display can stay conservative until protocol expansion is justified.

### CLI Commands

`potato diff`:

- defaults to the current workspace;
- prints a compact file list and optional patch text;
- reuses `DiffService`.

`potato trace`:

- lists recent traces by default;
- supports viewing a trace by task id;
- supports a compact summary first, with raw JSONL available through a flag.

The commands are read-only.

### Tool Boundary

`ToolBoundary` models the product-owned decision point:

- `allow`: execute without asking;
- `confirm`: request approval before execution;
- `deny`: block execution;
- `readonly`: allow only read tools.

Initial tool classes:

- read tools: `read`, `ls`, `grep`, `find`;
- change tools: `edit`, `write`;
- shell tool: `bash`.

The boundary must be independently tested without Pi. It should emit trace records for decisions, approvals, denials, and execution results.

### Runtime/SDK Permission Path

M5 adds a switchable adapter path, selected by config or CLI option, to validate tool interception. The exact class name can be chosen during implementation after inspecting Pi SDK capabilities:

- `PiSdkAdapter` if SDK sessions expose tool hooks;
- `RuntimePiAdapter` if a local runtime process is the better boundary.

This path must record capability facts in trace:

- whether system prompt can be injected;
- whether skills can be injected;
- whether MCP descriptions can be injected;
- whether tool allow/deny can be enforced;
- whether tool calls can be intercepted before execution;
- whether approval decisions come from `ToolBoundary`.

If interception is not possible with the available SDK/RPC API, M5 should keep the adapter as a documented spike and mark the capability unsupported in trace and wiki.

## Data Flow

For `potato run` and TUI task execution:

1. CLI creates `RunTaskInput`.
2. `AgentGateway` calls `AgentOrchestrator`.
3. Orchestrator writes `task.input` trace entry.
4. Orchestrator yields `task.started`.
5. Adapter streams `AgentEvent`s.
6. Orchestrator writes each event to trace and yields it to the host.
7. On completion, orchestrator calls `DiffService`.
8. Orchestrator writes diff trace entry and yields `diff.produced` when appropriate.
9. Orchestrator writes final trace entry.

For `potato diff`, CLI calls `DiffService` directly through a small command wrapper.

For `potato trace`, CLI calls a trace reader API that summarizes JSONL files.

## Error Handling

- Trace write failures should fail the task only when trace is explicitly required. The default should record a CLI-visible error and continue execution, because losing the task execution would be worse than losing observability.
- Diff failures should not fail the task by default.
- Runtime/SDK permission path failures should fall back only when the user explicitly allows fallback. Silent fallback would make permission guarantees unclear.
- Tool denial should produce a structured failed tool result and a trace record.

## Testing

Core tests:

- `JsonlTraceStore` writes, appends, lists, and reads trace entries.
- `DiffService` maps Git status and diff output into `ChangeSet`.
- `AgentOrchestrator` writes trace entries around adapter events.
- `AgentOrchestrator` emits `diff.produced` after successful adapter completion.
- `ToolBoundary` applies allow, confirm, deny, bypass, and readonly modes.

CLI tests:

- `potato diff` prints changed files.
- `potato trace` lists and reads trace files.
- `run` still renders existing event output.

Validation commands:

```text
pnpm --filter @potato/protocol test
pnpm --filter @potato/core test
pnpm --filter @potato/cli test
pnpm --filter @potato/core typecheck
pnpm --filter @potato/cli typecheck
```

## Acceptance Criteria

M5 is complete when:

- `potato run` and TUI task execution can persist JSONL traces.
- `potato diff` shows Git-backed file changes.
- `potato trace` can list and inspect task traces.
- task completion can emit `diff.produced`.
- `ToolBoundary` has tested policy behavior independent of Pi.
- the runtime/SDK path records a factual capability report.
- wiki stage documents clearly say which permission guarantees are real on each adapter.

## Open Implementation Questions

- Whether Pi SDK exposes a session-level tool interception API.
- Whether runtime adapter should be a subprocess in this repo or a separate future package.
- Whether trace retention should be capped in M5 or deferred.

For M5, these questions should not block trace/diff delivery.
