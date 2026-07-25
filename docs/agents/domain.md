# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**: one glossary and one ADR directory at the root, shared across `apps/*`, `packages/*`, and `tools/research`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary of domain terms.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-paper-trading-default.md
│   └── 0002-live-execution-gate.md
├── apps/            ← web dashboard, trader CLIs
├── packages/        ← trader-core, motorsport-core
└── tools/research/  ← Python research scripts
```

The repo is a pnpm monorepo, but the packages share one domain (Polymarket trading), so terms are defined once at the root rather than per package. If a term ever means something genuinely different in two packages, that's the signal to split into a `CONTEXT-MAP.md` with per-context `CONTEXT.md` files — not before.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (live execution gate) — but worth reopening because…_
