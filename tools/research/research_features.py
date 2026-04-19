from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Sequence

DEFAULT_ACCURACY_BAND = 0.02
DEFAULT_DEPTH_LEVELS = 3
DEFAULT_HISTORY_LENGTH = 20
DEFAULT_TRUTH_HORIZON_MS = 5 * 60_000
DEFAULT_VALIDATION_FRACTION = 0.2
MAX_SIGNAL_DELTA = 0.025
DEFAULT_INVENTORY_BIAS_SCALE = 0.02

FEATURE_NAMES = [
    "midpoint",
    "spread",
    "top_level_imbalance",
    "depth_3_imbalance",
    "bid_depth_1",
    "ask_depth_1",
    "bid_depth_3",
    "ask_depth_3",
    "return_3",
    "return_10",
    "return_20",
    "volatility_3",
    "volatility_10",
    "volatility_20",
    "time_gap_ms",
    "lookback_span_ms",
    "base_fair_value",
    "fair_value_minus_midpoint",
    "tick_size",
    "last_trade_delta",
]


@dataclass(slots=True)
class SnapshotFeatures:
    market_id: str
    token_id: str
    timestamp: int
    current_midpoint: float
    base_fair_value: float
    tick_size: float
    feature_values: dict[str, float]
    baseline_inputs: dict[str, float]


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def as_fixed_number(value: float, decimals: int = 6) -> float:
    return round(float(value), decimals)


def coerce_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def average_abs_diff(values: Sequence[float]) -> float:
    if len(values) < 2:
        return 0.0
    deltas = [abs(current - previous) for previous, current in zip(values, values[1:])]
    return sum(deltas) / len(deltas)


def level_size(levels: Iterable[dict[str, Any]], depth: int) -> float:
    total = 0.0
    for level in list(levels)[:depth]:
        size = coerce_float(level.get("size"))
        if size is not None:
            total += size
    return total


def level_price(levels: Iterable[dict[str, Any]], index: int) -> float | None:
    all_levels = list(levels)
    if index >= len(all_levels):
        return None
    return coerce_float(all_levels[index].get("price"))


def top_level_imbalance(snapshot: dict[str, Any]) -> float:
    bids = snapshot.get("bids") or []
    asks = snapshot.get("asks") or []
    bid_size = level_size(bids, 1)
    ask_size = level_size(asks, 1)
    total = bid_size + ask_size
    return 0.0 if total <= 0 else (bid_size - ask_size) / total


def depth_imbalance(snapshot: dict[str, Any], depth: int = DEFAULT_DEPTH_LEVELS) -> float:
    bids = snapshot.get("bids") or []
    asks = snapshot.get("asks") or []
    bid_depth = level_size(bids, depth)
    ask_depth = level_size(asks, depth)
    total = bid_depth + ask_depth
    return 0.0 if total <= 0 else (bid_depth - ask_depth) / total


def estimate_fair_value(snapshot: dict[str, Any]) -> float | None:
    bids = snapshot.get("bids") or []
    asks = snapshot.get("asks") or []
    best_bid = level_price(bids, 0)
    best_ask = level_price(asks, 0)
    tick_size = coerce_float(snapshot.get("tickSize")) or 0.01

    if best_bid is not None and best_ask is not None:
        midpoint = (best_bid + best_ask) / 2
        spread = best_ask - best_bid
        imbalance = depth_imbalance(snapshot, DEFAULT_DEPTH_LEVELS)
        skew = imbalance * min(spread / 2, 0.02)
        return clamp(as_fixed_number(midpoint + skew), tick_size, 1 - tick_size)

    if best_bid is not None:
        return clamp(as_fixed_number(best_bid + tick_size), tick_size, 1 - tick_size)

    if best_ask is not None:
        return clamp(as_fixed_number(best_ask - tick_size), tick_size, 1 - tick_size)

    last_trade = coerce_float(snapshot.get("lastTradePrice"))
    if last_trade is not None:
        return clamp(as_fixed_number(last_trade), tick_size, 1 - tick_size)

    return None


def _series_value_at_lookback(series: Sequence[float], lookback: int) -> float:
    if len(series) <= 1:
        return 0.0
    anchor_index = max(0, len(series) - lookback)
    return series[-1] - series[anchor_index]


def _series_volatility(series: Sequence[float], lookback: int) -> float:
    if len(series) <= 1:
        return 0.0
    slice_start = max(0, len(series) - lookback)
    window = series[slice_start:]
    return average_abs_diff(window)


def _time_gap_ms(history: Sequence[dict[str, Any]]) -> float:
    if len(history) < 2:
        return 0.0
    latest = coerce_int(history[-1].get("timestamp"))
    previous = coerce_int(history[-2].get("timestamp"))
    if latest is None or previous is None:
        return 0.0
    return float(max(0, latest - previous))


def _lookback_span_ms(history: Sequence[dict[str, Any]]) -> float:
    if len(history) < 2:
        return 0.0
    latest = coerce_int(history[-1].get("timestamp"))
    oldest = coerce_int(history[0].get("timestamp"))
    if latest is None or oldest is None:
        return 0.0
    return float(max(0, latest - oldest))


def build_snapshot_features(history: Sequence[dict[str, Any]]) -> SnapshotFeatures | None:
    if not history:
        return None

    latest = history[-1]
    midpoint = coerce_float(latest.get("midpoint"))
    timestamp = coerce_int(latest.get("timestamp"))
    tick_size = coerce_float(latest.get("tickSize"))
    if midpoint is None or timestamp is None or tick_size is None:
        return None

    fair_value = estimate_fair_value(latest)
    if fair_value is None:
        return None

    valid_midpoints = [
        value
        for value in (coerce_float(record.get("midpoint")) for record in history)
        if value is not None
    ]
    if not valid_midpoints:
        return None

    bids = latest.get("bids") or []
    asks = latest.get("asks") or []
    best_bid = level_price(bids, 0)
    best_ask = level_price(asks, 0)
    spread = 0.0
    if best_bid is not None and best_ask is not None:
        spread = max(0.0, best_ask - best_bid)

    bid_depth_1 = level_size(bids, 1)
    ask_depth_1 = level_size(asks, 1)
    bid_depth_3 = level_size(bids, DEFAULT_DEPTH_LEVELS)
    ask_depth_3 = level_size(asks, DEFAULT_DEPTH_LEVELS)
    last_trade_price = coerce_float(latest.get("lastTradePrice"))
    last_trade_delta = 0.0 if last_trade_price is None else last_trade_price - midpoint

    momentum = valid_midpoints[-1] - valid_midpoints[0] if len(valid_midpoints) >= 2 else 0.0
    volatility = average_abs_diff(valid_midpoints)
    imbalance = top_level_imbalance(latest)

    feature_values = {
        "midpoint": midpoint,
        "spread": spread,
        "top_level_imbalance": imbalance,
        "depth_3_imbalance": depth_imbalance(latest, DEFAULT_DEPTH_LEVELS),
        "bid_depth_1": bid_depth_1,
        "ask_depth_1": ask_depth_1,
        "bid_depth_3": bid_depth_3,
        "ask_depth_3": ask_depth_3,
        "return_3": _series_value_at_lookback(valid_midpoints, 3),
        "return_10": _series_value_at_lookback(valid_midpoints, 10),
        "return_20": _series_value_at_lookback(valid_midpoints, 20),
        "volatility_3": _series_volatility(valid_midpoints, 3),
        "volatility_10": _series_volatility(valid_midpoints, 10),
        "volatility_20": _series_volatility(valid_midpoints, 20),
        "time_gap_ms": _time_gap_ms(history),
        "lookback_span_ms": _lookback_span_ms(history),
        "base_fair_value": fair_value,
        "fair_value_minus_midpoint": fair_value - midpoint,
        "tick_size": tick_size,
        "last_trade_delta": last_trade_delta,
    }

    return SnapshotFeatures(
        market_id=str(latest.get("marketId") or ""),
        token_id=str(latest.get("tokenId") or ""),
        timestamp=timestamp,
        current_midpoint=midpoint,
        base_fair_value=fair_value,
        tick_size=tick_size,
        feature_values={key: as_fixed_number(value, 8) for key, value in feature_values.items()},
        baseline_inputs={
            "momentum": as_fixed_number(momentum, 8),
            "imbalance": as_fixed_number(imbalance, 8),
            "volatility": as_fixed_number(volatility, 8),
        },
    )


def vectorize_features(feature_values: dict[str, float]) -> list[float]:
    return [float(feature_values[name]) for name in FEATURE_NAMES]


def heuristic_predicted_delta(baseline_inputs: dict[str, float]) -> float:
    raw_score = (
        baseline_inputs.get("momentum", 0.0) * 0.6
        + baseline_inputs.get("imbalance", 0.0) * 0.3
        + baseline_inputs.get("volatility", 0.0) * -0.2
    )
    return clamp(raw_score, -MAX_SIGNAL_DELTA, MAX_SIGNAL_DELTA)

