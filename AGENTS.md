# AGENTS.md

Shared guidance for coding agents working in this repository.

## Project Snapshot

- This is a monorepo for a Polymarket trading runtime plus research tooling.
- The main surfaces are:
  - `apps/web`: Next.js research dashboard
  - `apps/trader`: CLI entrypoints for paper and replay bots
  - `packages/trader-core`: shared trading runtime and strategy code
  - `packages/motorsport-core`: legacy motorsport package still kept in-repo
  - `tools/research`: Python research, replay, dataset, and signal scripts

## Common Commands

- Install dependencies: `make install`
- Install training extras: `make install-train`
- Run checks: `make check`
- Run tests: `make test`
- Build workspace: `make build`
- Start web app: `pnpm dev:web`
- Run paper bot: `make paper`
- Run replay bot: `make replay REPLAY_INPUT_PATH=...`

## Guardrails

- Keep shared JS tooling at the repo root. `typescript`, `vitest`, `oxlint`, and `oxfmt` should not be redeclared per package unless there is an explicit repo-wide migration.
- Prefer the existing workspace commands in `Makefile` and root `package.json` over ad hoc package-specific flows.
- Default trading mode is paper trading. Live execution must stay gated behind `ALLOW_LIVE_EXECUTION=true`.
- The web app should degrade gracefully when required market env vars are missing or invalid.

## Working Style

- Make minimal, focused changes that match the existing monorepo structure.
- When touching both TypeScript and Python codepaths, keep command and verification steps explicit.
- Update this file if repo-wide agent guidance changes.
