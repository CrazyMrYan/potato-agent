# NPM Release

This project publishes the CLI as `@potato/cli`.

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

## Run Built CLI Directly

The release bundle keeps `@earendil-works/pi-coding-agent` as an external production dependency, so install release dependencies before running `dist/cli.js` directly:

```bash
cd .release/npm/cli
npm install --omit=dev --ignore-scripts
node dist/cli.js --help
```

## Local Install Test

Create a local tarball:

```bash
cd .release/npm/cli
npm pack
```

Install it globally from the generated tarball:

```bash
npm install -g ./potato-cli-0.1.0.tgz
potato --help
potato
```

Or test through `npx` from the local tarball:

```bash
npx ./potato-cli-0.1.0.tgz --help
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
npx @potato/cli --help
npx @potato/cli
```

Install globally:

```bash
npm install -g @potato/cli
potato --help
potato
```

Run one-shot commands:

```bash
potato --print "review this repository"
potato enhancements
potato doctor
```

## Notes

- The release bundle is minified with esbuild.
- Minification is not a security boundary. Do not put secrets in client-side or published code.
- `@earendil-works/pi-coding-agent` remains an npm dependency of the published package instead of being bundled.
- Potato-specific MCP and subagent enhancements are configured through `.potato/config.json`; see `docs/potato-config.example.json` in the repository.
