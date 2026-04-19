from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from build_dataset import build_dataset_from_path, dataset_to_matrices, write_dataset_artifacts
from neural_mlp import (
    TrainingConfig,
    available_training_backends,
    evaluate_predictions,
    save_checkpoint,
    standardize_features,
    train_model,
)
from research_features import DEFAULT_INVENTORY_BIAS_SCALE, FEATURE_NAMES, heuristic_predicted_delta


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train a neural Polymarket signal model from offline JSONL artifacts.",
    )
    parser.add_argument("--input", required=True, help="Path to market-snapshots.jsonl")
    parser.add_argument("--market", help="Optional market id filter")
    parser.add_argument("--out-dir", required=True, help="Directory for checkpoints and metrics")
    parser.add_argument("--epochs", type=int, default=120, help="Maximum training epochs")
    parser.add_argument("--batch-size", type=int, default=32, help="Mini-batch size")
    parser.add_argument("--learning-rate", type=float, default=0.003, help="Optimizer learning rate")
    parser.add_argument("--dropout", type=float, default=0.1, help="Dropout rate for hidden layers")
    parser.add_argument(
        "--hidden-sizes",
        default="64,32",
        help="Comma-separated hidden layer sizes",
    )
    parser.add_argument("--seed", type=int, default=7, help="Random seed")
    parser.add_argument(
        "--time-budget-seconds",
        type=float,
        default=300.0,
        help="Soft time budget for training",
    )
    parser.add_argument(
        "--require-baseline-improvement",
        action="store_true",
        help="Exit non-zero if validation MAE does not beat the heuristic baseline",
    )
    parser.add_argument(
        "--backend",
        default="auto",
        choices=["auto", "torch", "numpy"],
        help="Training backend preference",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cuda", "mps"],
        help="Training device preference when using the torch backend",
    )
    return parser.parse_args()


def _parse_hidden_sizes(raw: str) -> tuple[int, ...]:
    values = tuple(int(part.strip()) for part in raw.split(",") if part.strip())
    if not values:
        raise ValueError("Expected at least one hidden layer size")
    return values


def _as_numpy(matrices: dict[str, list[Any]]) -> dict[str, np.ndarray]:
    return {
        "features": np.asarray(matrices["features"], dtype=np.float64),
        "target_delta": np.asarray(matrices["target_delta"], dtype=np.float64),
        "base_fair_value": np.asarray(matrices["base_fair_value"], dtype=np.float64),
        "future_midpoint": np.asarray(matrices["future_midpoint"], dtype=np.float64),
    }


def _evaluate_heuristic_baseline(val_matrices: dict[str, list[Any]]) -> dict[str, float]:
    predicted_delta = np.asarray(
        [heuristic_predicted_delta(payload) for payload in val_matrices["baseline_inputs"]],
        dtype=np.float64,
    )
    target_delta = np.asarray(val_matrices["target_delta"], dtype=np.float64)
    base_fair_value = np.asarray(val_matrices["base_fair_value"], dtype=np.float64)
    future_midpoint = np.asarray(val_matrices["future_midpoint"], dtype=np.float64)
    return evaluate_predictions(
        predicted_delta,
        target_delta,
        base_fair_value,
        future_midpoint,
    )


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    dataset = build_dataset_from_path(args.input, args.market)
    write_dataset_artifacts(out_dir, dataset, args.input, args.market)

    train_matrices = dataset_to_matrices(dataset.train_examples)
    val_matrices = dataset_to_matrices(dataset.val_examples)
    train_arrays = _as_numpy(train_matrices)
    val_arrays = _as_numpy(val_matrices)

    train_x = train_arrays["features"]
    val_x = val_arrays["features"]
    normalized_train_x, normalized_val_x, feature_mean, feature_std = standardize_features(
        train_x,
        val_x,
    )

    config = TrainingConfig(
        hidden_sizes=_parse_hidden_sizes(args.hidden_sizes),
        dropout=args.dropout,
        learning_rate=args.learning_rate,
        batch_size=args.batch_size,
        epochs=args.epochs,
        seed=args.seed,
        time_budget_seconds=args.time_budget_seconds,
        backend=args.backend,
        device=args.device,
    )

    result = train_model(
        normalized_train_x,
        train_arrays["target_delta"],
        train_arrays["base_fair_value"],
        train_arrays["future_midpoint"],
        normalized_val_x,
        val_arrays["target_delta"],
        val_arrays["base_fair_value"],
        val_arrays["future_midpoint"],
        config,
        history_path=out_dir / "training-history.jsonl",
    )

    heuristic_metrics = _evaluate_heuristic_baseline(val_matrices)
    validation_metrics = result["validationMetrics"]
    beats_baseline = validation_metrics["mae"] < heuristic_metrics["mae"]

    metadata = {
        "marketId": args.market,
        "inputDim": len(FEATURE_NAMES),
        "featureNames": FEATURE_NAMES,
        "hiddenSizes": list(config.hidden_sizes),
        "dropout": config.dropout,
        "seed": config.seed,
        "deltaScale": result["deltaScale"],
        "reliabilityFactor": result["reliabilityFactor"],
        "inventoryBiasScale": DEFAULT_INVENTORY_BIAS_SCALE,
        "trainingBackend": result["trainingBackend"],
        "trainingDevice": result["trainingDevice"],
        "torchVersion": result["torchVersion"],
    }
    save_checkpoint(
        out_dir / "best-checkpoint.npz",
        result["modelState"],
        metadata,
        feature_mean,
        feature_std,
    )

    metrics = {
        "primaryMetric": "validation.mae",
        "bestEpoch": result["bestEpoch"],
        "train": result["trainMetrics"],
        "validation": validation_metrics,
        "heuristicBaseline": heuristic_metrics,
        "beatsHeuristicBaseline": beats_baseline,
        "trainingBackend": result["trainingBackend"],
        "trainingDevice": result["trainingDevice"],
        "torchVersion": result["torchVersion"],
        "availableBackends": available_training_backends(),
        "featureNames": FEATURE_NAMES,
        "trainingConfig": config.to_dict(),
        "calibration": {
            "deltaScale": result["deltaScale"],
            "reliabilityFactor": result["reliabilityFactor"],
            "validationConfidenceProxyMean": result["validationConfidenceProxyMean"],
        },
        "artifacts": {
            "checkpoint": "best-checkpoint.npz",
            "datasetManifest": "dataset-manifest.json",
            "history": "training-history.jsonl",
        },
    }
    (out_dir / "metrics.json").write_text(
        json.dumps(metrics, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    (out_dir / "train-config.json").write_text(
        json.dumps(config.to_dict(), indent=2, sort_keys=True),
        encoding="utf-8",
    )

    if args.require_baseline_improvement and not beats_baseline:
        raise SystemExit("Neural model did not beat the heuristic baseline on validation MAE")

    print(json.dumps(metrics, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
