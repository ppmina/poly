# Research Workspace

This folder is the Python sidecar for offline research and signal generation. It works only on local JSONL artifacts captured by the TypeScript bot, so you can iterate on features and replay sessions without touching live APIs.

Use `uv sync` at the repo root before running these tools.

## Files

- `signal_contract.py`: shared signal validation and JSONL loading helpers
- `generate_signal.py`: baseline offline signal generator that writes `SignalSnapshot` JSON
- `replay_session.py`: quick replay/session summary over captured JSONL files
- `model_weights.example.json`: editable heuristic weights for the baseline model scaffold

## Typical Flow

1. Run the paper bot and capture `artifacts/market-snapshots.jsonl`
2. Generate a signal file:
   `uv run python research/generate_signal.py --input artifacts/market-snapshots.jsonl --market market-id --output artifacts/signals/current.json`
3. Start the bot again in paper mode so the TypeScript runtime can ingest the signal file
4. Use `uv run python research/replay_session.py --input artifacts/market-snapshots.jsonl` to inspect replay sessions offline
