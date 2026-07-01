# Architecture

## Current Direction

Build a developer-focused coding agent with the core workflow validated through a CLI before investing in desktop UI.

The product should first prove that it can:

- Accept a developer task.
- Use Pi as the agent core layer.
- Inspect and reason over a local codebase.
- Show progress while the agent works.
- Apply or propose code changes.
- Display diffs clearly.
- Run verification commands when needed.
- Report what changed and what remains uncertain.

## Core Decision

Use Pi directly as the core agent layer.

The first host UI should be a CLI. The CLI does not need a polished interface. It only needs to make the agent loop observable:

- Current step
- Tool/action being executed
- Important command output
- Files touched
- Diff preview
- Final summary

## Removed From Scope

Claude Code is not part of the core architecture.

It may be useful as a market reference later, but it should not be used as the runtime, backend, or hidden dependency for this project.

## Initial System Model

```text
CLI
  User-facing validation shell.
  Starts tasks, streams progress, displays diffs, asks for confirmation.

Pi Core Layer
  Agent runtime.
  Handles task loop, tool calling, context, planning, and execution.

Tool Runtime
  Local capabilities exposed to the agent.
  Includes file read/write, search, patch, shell, git diff, and test commands.

Knowledge Base
  Project memory stored in this wiki.
  Keeps decisions, experiments, and architecture notes explicit.
```

## Near-Term Validation

The first practical milestone is a CLI that can run a task against a local repository and show:

```text
task received
context gathered
plan or next action
tool/action progress
diff
verification result
summary
```

The CLI is only the validation shell. The long-term product can later add a desktop host without replacing the core model.
