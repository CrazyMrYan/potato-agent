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

Project notes and decisions live in [`wiki/`](wiki/README.md).
