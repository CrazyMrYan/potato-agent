# Project Memory

## Current Direction

Potato is a thin, non-invasive wrapper around Pi.

The default runtime path is:

```text
@potato/cli -> Pi public main() -> Pi CLI/TUI/runtime
```

Pi owns TUI, sessions, tools, skills, compaction, model selection, and agent execution. Potato only owns launcher behavior, doctor checks, release packaging, and optional extension factories.

## Rules

- Do not rebuild Pi-owned TUI or runtime behavior in Potato.
- Prefer Pi public exports over internal paths, raw event schemas, or generated runtime files.
- Keep Potato enhancements optional, explicit, and easy to disable.
- Do not write into `.pi/` by default.
- Keep docs aligned with code after architectural changes.
