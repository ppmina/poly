from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Iterable


def utc_now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


@dataclass(slots=True)
class SignalSnapshot:
    market_id: str
    timestamp: int
    fair_value_adj_bps: float
    inventory_bias: float
    confidence: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "marketId": self.market_id,
            "timestamp": self.timestamp,
            "fairValueAdjBps": self.fair_value_adj_bps,
            "inventoryBias": self.inventory_bias,
            "confidence": self.confidence,
        }

    def write_json(self, path: str | Path) -> None:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.to_dict(), indent=2), encoding="utf-8")

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "SignalSnapshot":
        market_id = str(payload["marketId"])
        timestamp = int(payload["timestamp"])
        fair_value_adj_bps = float(payload["fairValueAdjBps"])
        inventory_bias = max(-1.0, min(1.0, float(payload["inventoryBias"])))
        confidence = max(0.0, min(1.0, float(payload["confidence"])))
        return cls(
            market_id=market_id,
            timestamp=timestamp,
            fair_value_adj_bps=fair_value_adj_bps,
            inventory_bias=inventory_bias,
            confidence=confidence,
        )


def load_jsonl(path: str | Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue

            payload = json.loads(line)
            if isinstance(payload, dict) and isinstance(payload.get("snapshot"), dict):
                payload = payload["snapshot"]
            records.append(payload)

    return records


def filter_market(records: Iterable[dict[str, Any]], market_id: str | None) -> list[dict[str, Any]]:
    if market_id is None:
        return list(records)
    return [record for record in records if record.get("marketId") == market_id]

