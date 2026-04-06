from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from signal_contract import SignalSnapshot, filter_market, load_jsonl, utc_now_ms


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a baseline Polymarket signal from JSONL market snapshots.")
    parser.add_argument("--input", required=True, help="Path to market-snapshots.jsonl")
    parser.add_argument("--market", help="Optional market id filter")
    parser.add_argument("--output", required=True, help="Where to write the current signal JSON file")
    parser.add_argument(
        "--weights",
        default=str(Path(__file__).with_name("model_weights.example.json")),
        help="JSON file with heuristic feature weights",
    )
    parser.add_argument("--lookback", type=int, default=50, help="Number of recent snapshots to use")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    records = filter_market(load_jsonl(args.input), args.market)
    if not records:
        raise SystemExit("No market snapshots found for the requested market")

    window = records[-args.lookback :]
    latest = window[-1]
    market_id = str(latest["marketId"])
    weights = load_weights(args.weights)

    midpoints = [record.get("midpoint") for record in window if isinstance(record.get("midpoint"), (int, float))]
    if len(midpoints) < 2:
      raise SystemExit("Not enough midpoint data to generate a signal")

    momentum = float(midpoints[-1]) - float(midpoints[0])
    volatility = average_abs_diff(midpoints)
    imbalance = top_level_imbalance(latest)

    raw_score = (
        momentum * weights["momentum"]
        + imbalance * weights["imbalance"]
        + volatility * weights["volatility"]
    )
    fair_value_adj_bps = clamp(raw_score * 10_000, -250.0, 250.0)
    inventory_bias = clamp(imbalance + momentum * 4, -1.0, 1.0)
    confidence = clamp(abs(momentum) * 20 + abs(imbalance) * 0.5, 0.1, 1.0)

    signal = SignalSnapshot(
        market_id=market_id,
        timestamp=utc_now_ms(),
        fair_value_adj_bps=fair_value_adj_bps,
        inventory_bias=inventory_bias,
        confidence=confidence,
    )
    signal.write_json(args.output)

    summary = {
        "marketId": market_id,
        "snapshotsUsed": len(window),
        "momentum": round(momentum, 6),
        "volatility": round(volatility, 6),
        "imbalance": round(imbalance, 6),
        "signal": signal.to_dict(),
    }
    print(json.dumps(summary, indent=2))


def load_weights(path: str) -> dict[str, float]:
    payload: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    return {
        "momentum": float(payload.get("momentum", 0.6)),
        "imbalance": float(payload.get("imbalance", 0.3)),
        "volatility": float(payload.get("volatility", -0.2)),
    }


def average_abs_diff(values: list[float]) -> float:
    deltas = [abs(current - previous) for previous, current in zip(values, values[1:])]
    return sum(deltas) / len(deltas)


def top_level_imbalance(record: dict[str, Any]) -> float:
    bids = record.get("bids") or []
    asks = record.get("asks") or []
    bid_size = float(bids[0]["size"]) if bids else 0.0
    ask_size = float(asks[0]["size"]) if asks else 0.0
    total = bid_size + ask_size
    return 0.0 if total == 0 else (bid_size - ask_size) / total


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


if __name__ == "__main__":
    main()

