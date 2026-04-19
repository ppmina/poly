# Research Workspace

This folder is the Python sidecar for offline research and signal generation. It works only on local JSONL artifacts captured by the TypeScript bot, so you can iterate on features and replay sessions without touching live APIs.

Use `uv sync` at the repo root before running these tools. For accelerated training, use `uv sync --extra train` so `train_signal_model.py` can prefer PyTorch and automatically select `cuda`, `mps`, or `cpu`.

## Files

- `signal_contract.py`: shared signal validation and JSONL loading helpers
- `generate_signal.py`: baseline offline signal generator that writes `SignalSnapshot` JSON
- `research_features.py`: shared feature engineering and heuristic-baseline helpers
- `build_dataset.py`: deterministic train/validation dataset builder for neural research
- `neural_mlp.py`: NumPy fallback inference plus backend-aware training helpers that prefer PyTorch when installed
- `train_signal_model.py`: trains/evaluates the neural signal model and writes checkpoints + metrics
- `generate_nn_signal.py`: loads a neural checkpoint and emits a `SignalSnapshot` JSON file
- `replay_session.py`: quick replay/session summary over captured JSONL files
- `model_weights.example.json`: editable heuristic weights for the baseline model scaffold
- `AUTORESEARCH.md`: repo-local contract for using `autoresearch` against this research module

## Typical Flow

1. Run the paper bot and capture `artifacts/market-snapshots.jsonl`
2. Generate a heuristic signal file:
   `uv run python tools/research/generate_signal.py --input artifacts/market-snapshots.jsonl --market market-id --output artifacts/signals/current.json`
3. Train the neural signal model:
   `uv run python tools/research/train_signal_model.py --input artifacts/market-snapshots.jsonl --market market-id --out-dir artifacts/models/latest`
   Add `--backend torch --device auto` to force the PyTorch path once the training extra is installed.
4. Generate a neural signal file:
   `uv run python tools/research/generate_nn_signal.py --input artifacts/market-snapshots.jsonl --market market-id --checkpoint artifacts/models/latest/best-checkpoint.npz --output artifacts/signals/current.json`
5. Start the bot again in paper mode so the TypeScript runtime can ingest the signal file
6. Use `uv run python tools/research/replay_session.py --input artifacts/market-snapshots.jsonl` to inspect replay sessions offline

## Neural Artifacts

The neural training flow writes these files into `--out-dir`:

- `dataset-manifest.json`: frozen split metadata and feature names
- `train-examples.jsonl` / `val-examples.jsonl`: deterministic supervised examples
- `training-history.jsonl`: per-epoch train/validation metrics
- `train-config.json`: model/training hyperparameters
- `metrics.json`: best validation metrics, heuristic comparison, and calibration
- `metrics.json`: also records which backend/device trained the exported checkpoint
- `best-checkpoint.npz`: model weights plus normalization/calibration metadata
