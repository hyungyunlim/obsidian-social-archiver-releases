# @social-archiver/cli-core

Host-agnostic CLI contract shared by the Social Archiver **desktop app** and
**Obsidian plugin**. Pure TypeScript — no Obsidian, Tauri, DOM, or client deps.

Consumed via a `file:` dependency, mirroring `@social-archiver/highlight-core`.
Build output (`dist/`) is committed so consumers resolve without a build step.

## What's here

- `core/response` — `CliResponse` envelope, `ErrorCode` + `RETRYABLE_BY_CODE`, redaction, `BILLING_FALLBACK_MESSAGE`, `format`.
- `core/params` — flag parsers (`PathResolver`-injected; no host import).
- `core/flags` — `COMMANDS`, `*_FLAGS`, `COMMAND_DESCRIPTIONS`, `FLAGS_BY_COMMAND`.
- `core/host` — `ArchiverCliHost` interface + result shapes + `HostError`.
- `core/handlers` — parse → `host.method()` → `CliResponse`.
- `core/registry` — `dispatch()` (no-throw, capability-gated).
- `runner` — `parseArgv` + `runCli` argv layer.
- `mock-host` — `MockArchiverCliHost` for tests / `--host=mock`.

Each client adds its own host adapter (e.g. `DesktopCliHost` wrapping
`DesktopApiClient`; a future `ObsidianCliHost` wrapping plugin services).

## Develop

```bash
cd packages/cli-core
npm install
npm test         # vitest (src tests)
npm run build    # tsc -> dist (commit the result)
```

> After changing `src/`, run `npm run build` so consumers (which import the
> compiled `dist/`) pick up the change — same constraint as highlight-core.
