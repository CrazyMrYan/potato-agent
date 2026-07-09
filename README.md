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

Current execution path:

```text
@potato/cli -> Pi public main() -> Pi CLI/TUI/runtime
```

Potato-owned code is limited to launcher behavior, doctor checks, release packaging, and optional extension factories.

## Potato Enhancements

Potato does not fork Pi's TUI or runtime. Enhancements are injected through Pi's public extension API:

- Write/command approval is enabled by default as a `tool_call` hook for mutating tools such as `bash`, `edit`, and `write`.
- MCP servers can be bridged into Pi as runtime-registered tools.
- Configured subagents are exposed through a `potato_subagent` tool that runs isolated Pi RPC sessions.

Configure optional enhancements in `.potato/config.json`:

```json
{
  "enhancements": {
    "approval": true,
    "mcpServers": [
      {
        "name": "docs",
        "command": "npx",
        "args": ["mcp-docs"]
      }
    ],
    "subagents": [
      {
        "id": "reviewer",
        "description": "Review code changes",
        "systemPrompt": "You review code for correctness, regressions, and missing tests.",
        "tools": ["read", "grep"]
      }
    ]
  }
}
```

The same shape is available as [`docs/potato-config.example.json`](docs/potato-config.example.json).

Potato does not write `.pi/` or generate `.potato/runtime/*.ts` by default. The enhancement layer is in-memory for the current Pi run, so Pi upgrades remain easy to track.

Passing Pi's `--no-extensions` or `-ne` also disables Potato's in-memory enhancement factories for that run.

Project notes and decisions live in [`wiki/`](wiki/README.md).
