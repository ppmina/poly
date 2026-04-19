from __future__ import annotations

import argparse
import json

import numpy as np

from build_dataset import latest_snapshot_features
from neural_mlp import calibrate_confidence, load_checkpoint, sigmoid
from research_features import DEFAULT_INVENTORY_BIAS_SCALE, MAX_SIGNAL_DELTA, clamp, vectorize_features
from signal_contract import SignalSnapshot, utc_now_ms


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a neural SignalSnapshot JSON file from JSONL market snapshots.",
    )
    parser.add_argument("--input", required=True, help="Path to market-snapshots.jsonl")
    parser.add_argument("--market", help="Optional market id filter")
    parser.add_argument("--checkpoint", required=True, help="Path to best-checkpoint.npz")
    parser.add_argument("--output", required=True, help="Where to write the signal JSON file")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    features = latest_snapshot_features(args.input, args.market)
    model, metadata, feature_mean, feature_std = load_checkpoint(args.checkpoint)

    raw_vector = np.asarray(vectorize_features(features.feature_values), dtype=np.float64)
    normalized_vector = (raw_vector - feature_mean) / feature_std
    output = model.forward(normalized_vector.reshape(1, -1), training=False)[0]
    predicted_delta = clamp(float(output[0]), -MAX_SIGNAL_DELTA, MAX_SIGNAL_DELTA)
    raw_confidence = float(sigmoid(np.asarray([output[1]], dtype=np.float64))[0])
    confidence = calibrate_confidence(
        predicted_delta=predicted_delta,
        raw_confidence=raw_confidence,
        reliability_factor=float(metadata.get("reliabilityFactor", 0.5)),
        delta_scale=float(metadata.get("deltaScale", 0.01)),
    )

    fair_value_adj_bps = float(round(predicted_delta * 10_000, 6))
    inventory_bias_scale = float(metadata.get("inventoryBiasScale", DEFAULT_INVENTORY_BIAS_SCALE))
    inventory_bias = clamp(predicted_delta / max(inventory_bias_scale, 1e-6), -1.0, 1.0)

    signal = SignalSnapshot(
        market_id=features.market_id,
        timestamp=utc_now_ms(),
        fair_value_adj_bps=fair_value_adj_bps,
        inventory_bias=inventory_bias,
        confidence=confidence,
    )
    signal.write_json(args.output)

    predicted_future_midpoint = round(features.base_fair_value + predicted_delta, 6)
    summary = {
        "marketId": features.market_id,
        "checkpoint": args.checkpoint,
        "baseFairValue": features.base_fair_value,
        "currentMidpoint": features.current_midpoint,
        "predictedFutureMidpoint": predicted_future_midpoint,
        "predictedDelta": round(predicted_delta, 8),
        "signal": signal.to_dict(),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
