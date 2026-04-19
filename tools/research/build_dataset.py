from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from research_features import (
    DEFAULT_HISTORY_LENGTH,
    DEFAULT_TRUTH_HORIZON_MS,
    DEFAULT_VALIDATION_FRACTION,
    FEATURE_NAMES,
    SnapshotFeatures,
    build_snapshot_features,
    coerce_float,
    coerce_int,
    vectorize_features,
)
from signal_contract import filter_market, load_jsonl


@dataclass(slots=True)
class DatasetExample:
    market_id: str
    token_id: str
    predicted_at: int
    truth_at: int
    current_midpoint: float
    base_fair_value: float
    future_midpoint: float
    target_delta: float
    tick_size: float
    feature_values: dict[str, float]
    baseline_inputs: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "marketId": self.market_id,
            "tokenId": self.token_id,
            "predictedAt": self.predicted_at,
            "truthAt": self.truth_at,
            "currentMidpoint": self.current_midpoint,
            "baseFairValue": self.base_fair_value,
            "futureMidpoint": self.future_midpoint,
            "targetDelta": self.target_delta,
            "tickSize": self.tick_size,
            "featureValues": self.feature_values,
            "baselineInputs": self.baseline_inputs,
        }


@dataclass(slots=True)
class DatasetSplit:
    train_examples: list[DatasetExample]
    val_examples: list[DatasetExample]

    @property
    def all_examples(self) -> list[DatasetExample]:
        return [*self.train_examples, *self.val_examples]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a supervised neural-signal dataset from JSONL market snapshots.",
    )
    parser.add_argument("--input", required=True, help="Path to market-snapshots.jsonl")
    parser.add_argument("--market", help="Optional market id filter")
    parser.add_argument("--out-dir", required=True, help="Directory for dataset artifacts")
    return parser.parse_args()


def _sorted_records(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    sortable: list[tuple[int, dict[str, Any]]] = []
    for record in records:
        timestamp = coerce_int(record.get("timestamp"))
        if timestamp is None:
            continue
        sortable.append((timestamp, record))
    sortable.sort(key=lambda item: item[0])
    return [record for _, record in sortable]


def build_supervised_examples(
    records: Iterable[dict[str, Any]],
    truth_horizon_ms: int = DEFAULT_TRUTH_HORIZON_MS,
    history_length: int = DEFAULT_HISTORY_LENGTH,
) -> list[DatasetExample]:
    ordered = _sorted_records(records)
    if not ordered:
        return []

    examples: list[DatasetExample] = []
    future_index = 1

    for index, current in enumerate(ordered):
        current_timestamp = coerce_int(current.get("timestamp"))
        if current_timestamp is None:
            continue

        target_timestamp = current_timestamp + truth_horizon_ms
        future_index = max(future_index, index + 1)
        while future_index < len(ordered):
            future_timestamp = coerce_int(ordered[future_index].get("timestamp"))
            if future_timestamp is not None and future_timestamp >= target_timestamp:
                break
            future_index += 1

        if future_index >= len(ordered):
            break

        truth_index = future_index
        while truth_index < len(ordered):
            future_midpoint = coerce_float(ordered[truth_index].get("midpoint"))
            truth_timestamp = coerce_int(ordered[truth_index].get("timestamp"))
            if future_midpoint is not None and truth_timestamp is not None:
                break
            truth_index += 1

        if truth_index >= len(ordered):
            break

        history = ordered[max(0, index + 1 - history_length) : index + 1]
        features = build_snapshot_features(history)
        if features is None:
            continue

        truth_midpoint = coerce_float(ordered[truth_index].get("midpoint"))
        truth_timestamp = coerce_int(ordered[truth_index].get("timestamp"))
        if truth_midpoint is None or truth_timestamp is None:
            continue

        examples.append(
            DatasetExample(
                market_id=features.market_id,
                token_id=features.token_id,
                predicted_at=features.timestamp,
                truth_at=truth_timestamp,
                current_midpoint=features.current_midpoint,
                base_fair_value=features.base_fair_value,
                future_midpoint=truth_midpoint,
                target_delta=round(truth_midpoint - features.base_fair_value, 8),
                tick_size=features.tick_size,
                feature_values=features.feature_values,
                baseline_inputs=features.baseline_inputs,
            ),
        )

    return examples


def split_examples(
    examples: list[DatasetExample],
    validation_fraction: float = DEFAULT_VALIDATION_FRACTION,
) -> DatasetSplit:
    if len(examples) < 2:
        raise ValueError("Need at least two labeled examples to create a train/validation split")

    val_count = max(1, int(len(examples) * validation_fraction))
    if val_count >= len(examples):
        val_count = 1

    split_index = len(examples) - val_count
    if split_index <= 0:
        split_index = 1

    return DatasetSplit(
        train_examples=examples[:split_index],
        val_examples=examples[split_index:],
    )


def build_dataset_from_path(
    input_path: str | Path,
    market_id: str | None,
) -> DatasetSplit:
    records = filter_market(load_jsonl(input_path), market_id)
    examples = build_supervised_examples(records)
    return split_examples(examples)


def latest_snapshot_features(
    input_path: str | Path,
    market_id: str | None,
    history_length: int = DEFAULT_HISTORY_LENGTH,
) -> SnapshotFeatures:
    records = _sorted_records(filter_market(load_jsonl(input_path), market_id))
    if not records:
        raise ValueError("No market snapshots found for the requested market")

    for index in range(len(records) - 1, -1, -1):
        history = records[max(0, index + 1 - history_length) : index + 1]
        features = build_snapshot_features(history)
        if features is not None:
            return features

    raise ValueError("Unable to build features from the provided market snapshots")


def dataset_to_matrices(examples: list[DatasetExample]) -> dict[str, list[Any]]:
    return {
        "market_ids": [example.market_id for example in examples],
        "token_ids": [example.token_id for example in examples],
        "predicted_at": [example.predicted_at for example in examples],
        "truth_at": [example.truth_at for example in examples],
        "current_midpoint": [example.current_midpoint for example in examples],
        "base_fair_value": [example.base_fair_value for example in examples],
        "future_midpoint": [example.future_midpoint for example in examples],
        "target_delta": [example.target_delta for example in examples],
        "tick_size": [example.tick_size for example in examples],
        "features": [vectorize_features(example.feature_values) for example in examples],
        "baseline_inputs": [example.baseline_inputs for example in examples],
    }


def write_dataset_artifacts(
    out_dir: str | Path,
    dataset: DatasetSplit,
    source_path: str | Path,
    market_id: str | None,
) -> None:
    target_dir = Path(out_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    train_path = target_dir / "train-examples.jsonl"
    val_path = target_dir / "val-examples.jsonl"
    train_path.write_text(_serialize_jsonl(dataset.train_examples), encoding="utf-8")
    val_path.write_text(_serialize_jsonl(dataset.val_examples), encoding="utf-8")

    manifest = {
        "sourcePath": str(source_path),
        "marketId": market_id,
        "featureNames": FEATURE_NAMES,
        "truthHorizonMs": DEFAULT_TRUTH_HORIZON_MS,
        "historyLength": DEFAULT_HISTORY_LENGTH,
        "holdoutStrategy": "chronological_last_20_percent",
        "trainCount": len(dataset.train_examples),
        "validationCount": len(dataset.val_examples),
        "exampleCount": len(dataset.all_examples),
        "trainPath": train_path.name,
        "validationPath": val_path.name,
    }
    (target_dir / "dataset-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _serialize_jsonl(examples: list[DatasetExample]) -> str:
    lines = [json.dumps(example.to_dict(), sort_keys=True) for example in examples]
    return "".join(f"{line}\n" for line in lines)


def main() -> None:
    args = parse_args()
    dataset = build_dataset_from_path(args.input, args.market)
    write_dataset_artifacts(args.out_dir, dataset, args.input, args.market)
    summary = {
        "outDir": args.out_dir,
        "marketId": args.market,
        "featureCount": len(FEATURE_NAMES),
        "trainCount": len(dataset.train_examples),
        "validationCount": len(dataset.val_examples),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
