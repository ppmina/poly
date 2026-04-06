# Poly

Execution-first Polymarket trading bot scaffold for passive market making, with a paper executor in TypeScript and an offline research sidecar in Python.

## What is implemented

- TypeScript execution runtime with:
  - env/config validation
  - Polymarket CLOB gateway wrapper
  - passive market-making strategy engine
  - paper execution with simulated fills
  - JSONL artifact capture for snapshots, decisions, orders, fills, and sessions
  - replay gateway for offline session playback
- Python research workspace with:
  - shared `SignalSnapshot` contract helpers
  - baseline signal generator from captured JSONL snapshots
  - replay/session summarizer

## Quick start

1. Copy `.env.example` values into `.env`
2. Install dependencies:
   `make install`
3. Run the paper bot:
   `make paper`

## Useful commands

- Install everything: `make install`
- Type-check: `make check`
- Run tests: `make test`
- Build: `make build`
- Paper bot: `make paper`
- Replay bot: `make replay REPLAY_INPUT_PATH=artifacts/market-snapshots.jsonl`
- Generate a baseline signal:
  `make signal INPUT=artifacts/market-snapshots.jsonl MARKET=<market-id>`
- Summarize a session:
  `make summary INPUT=artifacts/market-snapshots.jsonl`

## Tooling

- `Makefile` is the top-level convenience layer for local workflows.
- `package.json` remains the source of truth for TypeScript commands.
- `pyproject.toml` and `uv.lock` remain the source of truth for Python environment management.
- You can always run the underlying commands directly with `pnpm ...` or `uv run ...` when debugging.

## Runtime notes

- Default mode is paper trading only.
- Live execution is guarded behind `ALLOW_LIVE_EXECUTION=true`.
- The TypeScript bot ignores missing, stale, malformed, or cross-market signal files and falls back to rules-only quoting.
- A kill switch file at `KILL_SWITCH_FILE` can stop quoting with either `stop`, `true`, or JSON such as `{"stop": true, "reason": "manual stop"}`.
