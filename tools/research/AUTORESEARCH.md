# Autoresearch Contract

This repo uses the `autoresearch` pattern as a constrained experiment loop around the Python research module in `tools/research`.

## Objective

- Primary metric: lower validation MAE on the `+5 minute` future-midpoint task
- Secondary metrics: higher directional accuracy and higher `abs(diff) <= 0.02` band accuracy
- Output contract: always emit the existing `SignalSnapshot` JSON shape
- Preferred trainer: PyTorch with automatic device selection (`cuda`, `mps`, then `cpu`)

## Mutable Research Surface

- `tools/research/research_features.py`
- `tools/research/build_dataset.py`
- `tools/research/neural_mlp.py`
- `tools/research/train_signal_model.py`
- `tools/research/generate_nn_signal.py`

## Frozen Interfaces

- `tools/research/signal_contract.py`
- the `SignalSnapshot` keys and bounds
- JSONL market snapshot input shape
- deterministic chronological holdout split
- the TypeScript `FileSignalSource` consumer contract

## Suggested Loop

1. Train a candidate:
   `uv run python tools/research/train_signal_model.py --input <jsonl> --market <market-id> --out-dir artifacts/models/candidate --backend auto --device auto`
2. Read `artifacts/models/candidate/metrics.json`
3. Keep only changes that improve `validation.mae`
4. Generate a signal:
   `uv run python tools/research/generate_nn_signal.py --input <jsonl> --market <market-id> --checkpoint artifacts/models/candidate/best-checkpoint.npz --output artifacts/signals/current.json`

## Acceptance Gate

- Validation MAE should beat the heuristic baseline in `metrics.json`
- Signal output must stay within:
  - `fairValueAdjBps` in `[-250, 250]`
  - `inventoryBias` in `[-1, 1]`
  - `confidence` in `[0, 1]`
