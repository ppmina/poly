from __future__ import annotations

import argparse
import json
from statistics import mean

from signal_contract import filter_market, load_jsonl


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize a captured paper or replay session.")
    parser.add_argument("--input", required=True, help="Path to market-snapshots.jsonl")
    parser.add_argument("--market", help="Optional market id filter")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    records = filter_market(load_jsonl(args.input), args.market)
    if not records:
        raise SystemExit("No market snapshots found for the requested market")

    spreads = [
        float(record["asks"][0]["price"]) - float(record["bids"][0]["price"])
        for record in records
        if record.get("asks") and record.get("bids")
    ]
    midpoints = [float(record["midpoint"]) for record in records if isinstance(record.get("midpoint"), (int, float))]
    timestamps = [int(record["timestamp"]) for record in records if record.get("timestamp") is not None]
    market_ids = sorted({str(record["marketId"]) for record in records})

    summary = {
        "records": len(records),
        "markets": market_ids,
        "timeSpanMs": max(timestamps) - min(timestamps) if len(timestamps) >= 2 else 0,
        "midpointMin": min(midpoints) if midpoints else None,
        "midpointMax": max(midpoints) if midpoints else None,
        "averageSpread": round(mean(spreads), 6) if spreads else None,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

