# Project Memory

## Current Direction

Potato is a thin, non-invasive wrapper around Pi.

The default runtime path is:

```text
@potato/cli -> Pi public main() -> Pi CLI/TUI/runtime
```

Pi owns TUI, sessions, tools, skills, compaction, model selection, and agent execution. Potato owns launcher behavior, doctor checks, release packaging, and extension-based enhancements.

## Enhancement Layer

Enhancements are runtime extension factories passed to Pi public `main(args, { extensionFactories })`.

- Approval: enabled by default, intercepts mutating tool calls (`bash`, `edit`, `write`) and asks the attached Pi UI for confirmation.
- MCP bridge: configured MCP stdio servers are connected at startup and their tools are registered into Pi.
- SubAgent: configured agents are exposed through `potato_subagent`; each invocation starts an isolated Pi RPC session with the subagent system prompt.
- Pi `--no-extensions` / `-ne`: disables Potato enhancement injection for that run.

Optional enhancement config lives at `.potato/config.json`:

```json
{
  "enhancements": {
    "approval": true,
    "mcpServers": [{ "name": "docs", "command": "npx", "args": ["mcp-docs"] }],
    "subagents": [
      {
        "id": "reviewer",
        "description": "Review code",
        "systemPrompt": "You review code.",
        "tools": ["read", "grep"]
      }
    ]
  }
}
```

## Rules

- Do not rebuild Pi-owned TUI or runtime behavior in Potato.
- Prefer Pi public exports over internal paths, raw event schemas, or generated runtime files.
- Keep Potato enhancements optional, explicit, and easy to disable.
- Do not write into `.pi/` by default.
- Do not generate `.potato/runtime/*.ts` by default.
- Keep docs aligned with code after architectural changes.
