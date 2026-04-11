# Poly

Poly is now a monorepo with two product tracks:

- a Polymarket trading runtime in TypeScript plus Python research tooling
- a new multi-series motorsport web app that streams `liveline` charts for live race gaps, intervals, and position history

## Workspace Layout

- `apps/trader`: CLI entrypoints for the paper and replay bots
- `apps/web`: Next.js motorsport frontend powered by `liveline`
- `packages/trader-core`: shared Polymarket bot runtime, strategy, gateways, and tests
- `packages/motorsport-core`: racing-domain types, replay/demo adapters, and Liveline transforms
- `tools/research`: Python replay and signal-generation sidecar

## Quick Start

1. Copy `.env.example` values into `.env`
2. Install everything:
   `make install`
3. Start the web app:
   `pnpm dev:web`
4. Run the paper bot:
   `make paper`

## Useful Commands

- Install everything: `make install`
- Type-check the workspace: `make check`
- Run tests: `make test`
- Build the workspace: `make build`
- Run the web app locally: `pnpm dev:web`
- Paper bot: `make paper`
- Replay bot: `make replay REPLAY_INPUT_PATH=artifacts/market-snapshots.jsonl`
- Generate a baseline signal:
  `make signal INPUT=artifacts/market-snapshots.jsonl MARKET=<market-id>`
- Summarize a captured session:
  `make summary INPUT=artifacts/market-snapshots.jsonl`

## Toolchain Guardrail

- Shared tooling stays root-owned: `typescript`, `vitest`, `oxlint`, and `oxfmt` should be declared once in the root `package.json`.
- Workspace packages should reuse the root toolchain instead of redeclaring those dependencies locally.
- Adding a competing lint/test/format/compile tool should happen only as part of an explicit repo-wide migration.

## Motorsports App Notes

- The first web release defaults to a demo replay feed so the app always has live-moving chart data.
- Series currently exposed in the UI: `F1`, `IndyCar`, `WEC`, and `Formula E`.
- The shared feed adapter contract is ready for a real provider-backed stream via `LIVE_FEED_MODE=provider`.

## Trading Runtime Notes

- Default mode is paper trading only.
- Live market data now uses the Polymarket market WebSocket; `POLL_INTERVAL_MS` remains replay-only.
- Live execution is guarded behind `ALLOW_LIVE_EXECUTION=true`.
- The bot ignores missing, stale, malformed, or cross-market signal files and falls back to rules-only quoting.
- A kill switch file at `KILL_SWITCH_FILE` can stop quoting with either `stop`, `true`, or JSON such as `{"stop": true, "reason": "manual stop"}`.
