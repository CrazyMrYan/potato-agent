# NPM Release

This project publishes the CLI as `@coding-agent/cli`.

The npm release package is built into `.release/npm/cli`. It contains a bundled, minified CLI entrypoint instead of the TypeScript source tree.

## Build

From the repository root:

```bash
pnpm install
pnpm build:npm:cli
```

The publishable package will be created here:

```text
.release/npm/cli
```

## Inspect Package Contents

```bash
cd .release/npm/cli
npm pack --dry-run
```

The package should include:

```text
dist/cli.js
package.json
README.md
```

## Local Install Test

Create a local tarball:

```bash
cd .release/npm/cli
npm pack
```

Install it globally from the generated tarball:

```bash
npm install -g ./coding-agent-cli-0.1.0.tgz
agent --help
agent
```

Or test through `npx` from the local tarball:

```bash
npx ./coding-agent-cli-0.1.0.tgz --help
```

## Publish

Login first if needed:

```bash
npm login
```

Publish from the release package directory:

```bash
cd .release/npm/cli
npm publish --access public
```

## User Commands After Publish

Run with `npx`:

```bash
npx @coding-agent/cli --help
npx @coding-agent/cli
```

Install globally:

```bash
npm install -g @coding-agent/cli
agent --help
agent
```

Run one-shot commands:

```bash
agent run "review this repository"
agent diff
agent trace
```

## Notes

- The release bundle is minified with esbuild.
- Minification is not a security boundary. Do not put secrets in client-side or published code.
- `@earendil-works/pi-coding-agent` remains an npm dependency of the published package instead of being bundled.
