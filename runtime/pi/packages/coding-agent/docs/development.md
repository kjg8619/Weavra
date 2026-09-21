# Development

See the [root Weavra checkout guidance](../../../../../README.md) for product setup.

## Setup

Complete the [root Weavra checkout setup](../../../../../README.md). The local runtime build context is `runtime/pi`; retain its lockfile acknowledgement, build and package-consumer gates.

Run the product through the checkout-bound `weavra` launcher. Local runtime development scripts remain available from `runtime/pi`.

### Experimental remote harness

The remote harness server/client integration is development-only. Run it from the repository with:

```bash
PI_EXPERIMENTAL=1 ./pi-test.sh server
PI_EXPERIMENTAL=1 ./pi-test.sh client
```

`WEAVRA_SERVER_DIR` overrides the server profile and socket directory; explicit `PI_SERVER_DIR` remains a compatibility input. Otherwise the directory is `<WEAVRA_HOME or ~/.weavra>/server` (default: `~/.weavra/server`). `PI_SERVER_ID` selects the logical server ID when `--server-id` is omitted.

The `client` and `experimental/plugin` package subpaths resolve only under the `source` condition in a checkout. Their implementations and the server/client commands are excluded from npm packages and standalone binaries. `pi-client`, `pi-protocol`, and `pi-server` are development dependencies of coding-agent, not runtime dependencies. The local SDK and stdio RPC API are unchanged.

## Forking / Rebranding

Product identity and home defaults are explicit in src/config.ts. Preserve package names/versions, project .pi paths, wire formats and the company-runtime launcher contract; do not derive product identity or home isolation from piConfig metadata.

## Path Resolution

Three execution modes: npm install, standalone binary, tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.weavra/agent/pi-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
./test.sh                         # Run non-LLM tests (no API keys needed)
npm test                          # Run all tests
npm test -- test/specific.test.ts # Run specific test
```

### Published package smoke test

After building, run `npm run check:package-install`. It packs the public packages and installs only coding-agent as a direct dependency in a temporary directory outside the repository. Local tarball overrides select declared transitive dependencies without installing development-only packages. The check verifies SDK imports and CLI startup without credentials or model requests.

`npm run check` also checks runtime dependency declarations and rejects excluded development sources pulled into a package's build through imports.

## Project Structure

```
packages/
  ai/           # LLM provider abstraction
  agent/        # Agent loop and message types  
  tui/          # Terminal UI components
  coding-agent/ # CLI and interactive mode
```
