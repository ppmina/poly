# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Claude Code

- **Verification gate.** Before claiming a non-doc change is done, run the affected slice: `pnpm check` for TS, `make check-py` for Python research, `make test` when behavior changed. Type-check alone is not "done."
- **UI changes need a browser check.** `pnpm dev:web` and exercise the change — type-check does not verify feature correctness.
- **Python entry points.** Always `uv run python …` (or the `make` targets), never bare `python`. The mise venv auto-source covers interactive shells, not your tool calls.
- **TypeScript checker is `tsgo`** (`@typescript/native-preview`), not stock `tsc`. Use `pnpm check` rather than invoking compilers directly.
- **Never bypass hooks.** No `--no-verify`. If lefthook fails, fix the root cause and re-stage. Don't run `oxfmt`/`oxlint`/`ruff` as ad-hoc mid-edit cleanup — let pre-commit handle staged files, or use `pnpm lint:fix` for an intentional batch sweep.
- **Never flip the live-execution gate.** Don't set `ALLOW_LIVE_EXECUTION=true` and don't read or write `POLYMARKET_PRIVATE_KEY` / `POLYMARKET_FUNDER_ADDRESS`, even when asked.
