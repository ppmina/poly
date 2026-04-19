from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from build_dataset import DEFAULT_TRUTH_HORIZON_MS, build_dataset_from_path
from neural_mlp import torch_available
from research_features import clamp


def write_snapshot_fixture(path: Path, market_id: str = "market-neural", count: int = 48) -> None:
    midpoint = 0.42
    start_timestamp = 1_710_000_000_000
    rows: list[dict[str, object]] = []

    for index in range(count):
        regime = 1.0 if (index // 4) % 2 == 0 else -1.0
        micro_skew = ((index % 5) - 2) / 12.0
        spread = 0.018 + (index % 3) * 0.002
        imbalance = clamp(regime * 0.65 + micro_skew, -0.92, 0.92)
        bid_size = round(95 + 40 * max(imbalance, 0), 4)
        ask_size = round(95 + 40 * max(-imbalance, 0), 4)
        depth_boost = round(30 + abs(imbalance) * 20, 4)
        last_trade_delta = regime * 0.006 + micro_skew * 0.002

        rows.append(
            {
                "marketId": market_id,
                "tokenId": "token-neural",
                "timestamp": start_timestamp + index * 30_000,
                "bids": [
                    {"price": round(midpoint - spread / 2, 6), "size": bid_size},
                    {"price": round(midpoint - spread / 2 - 0.01, 6), "size": bid_size + depth_boost},
                    {"price": round(midpoint - spread / 2 - 0.02, 6), "size": bid_size + depth_boost * 1.5},
                ],
                "asks": [
                    {"price": round(midpoint + spread / 2, 6), "size": ask_size},
                    {"price": round(midpoint + spread / 2 + 0.01, 6), "size": ask_size + depth_boost},
                    {"price": round(midpoint + spread / 2 + 0.02, 6), "size": ask_size + depth_boost * 1.5},
                ],
                "tickSize": 0.01,
                "minOrderSize": 1,
                "negRisk": False,
                "lastTradePrice": round(clamp(midpoint + last_trade_delta, 0.05, 0.95), 6),
                "midpoint": round(midpoint, 6),
                "bookHash": f"book-{index}",
                "source": "replay",
            }
        )

        step = regime * 0.0014 + 0.0006 * micro_skew + 0.0003 * (1 if index % 7 < 3 else -1)
        midpoint = clamp(midpoint + step, 0.08, 0.92)

    malformed = dict(rows[7])
    malformed["midpoint"] = None
    rows.insert(8, malformed)
    other_market = dict(rows[-1])
    other_market["marketId"] = "market-other"
    rows.append(other_market)

    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(f"{json.dumps(row, sort_keys=True)}\n")


class NeuralSignalPipelineTest(unittest.TestCase):
    def test_build_dataset_preserves_market_filter_and_truth_horizon(self) -> None:
        with tempfile.TemporaryDirectory(prefix="poly-research-dataset-") as tmp_dir:
            input_path = Path(tmp_dir) / "market-snapshots.jsonl"
            write_snapshot_fixture(input_path)

            dataset = build_dataset_from_path(input_path, "market-neural")
            self.assertGreater(len(dataset.train_examples), 0)
            self.assertGreater(len(dataset.val_examples), 0)
            all_examples = dataset.all_examples
            self.assertTrue(all(example.market_id == "market-neural" for example in all_examples))
            self.assertTrue(
                all(
                    example.truth_at - example.predicted_at >= DEFAULT_TRUTH_HORIZON_MS
                    for example in all_examples
                )
            )

    def test_training_and_signal_generation_smoke(self) -> None:
        with tempfile.TemporaryDirectory(prefix="poly-research-train-") as tmp_dir:
            tmp_path = Path(tmp_dir)
            input_path = tmp_path / "market-snapshots.jsonl"
            out_dir = tmp_path / "model-output"
            signal_path = tmp_path / "current-signal.json"
            write_snapshot_fixture(input_path)
            expected_backend = "torch" if torch_available() else "numpy"

            train_result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "train_signal_model.py"),
                    "--input",
                    str(input_path),
                    "--market",
                    "market-neural",
                    "--out-dir",
                    str(out_dir),
                    "--epochs",
                    "80",
                    "--batch-size",
                    "8",
                    "--time-budget-seconds",
                    "10",
                    "--backend",
                    expected_backend,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertTrue(train_result.stdout)
            metrics = json.loads((out_dir / "metrics.json").read_text(encoding="utf-8"))
            self.assertTrue((out_dir / "best-checkpoint.npz").exists())
            self.assertTrue((out_dir / "dataset-manifest.json").exists())
            self.assertTrue((out_dir / "training-history.jsonl").exists())
            self.assertLessEqual(metrics["bestEpoch"], 80)
            self.assertTrue(metrics["beatsHeuristicBaseline"])
            self.assertEqual(metrics["trainingBackend"], expected_backend)

            generate_result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "generate_nn_signal.py"),
                    "--input",
                    str(input_path),
                    "--market",
                    "market-neural",
                    "--checkpoint",
                    str(out_dir / "best-checkpoint.npz"),
                    "--output",
                    str(signal_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertTrue(generate_result.stdout)

            signal_payload = json.loads(signal_path.read_text(encoding="utf-8"))
            self.assertEqual(
                set(signal_payload.keys()),
                {"confidence", "fairValueAdjBps", "inventoryBias", "marketId", "timestamp"},
            )
            self.assertEqual(signal_payload["marketId"], "market-neural")
            self.assertGreaterEqual(signal_payload["confidence"], 0.0)
            self.assertLessEqual(signal_payload["confidence"], 1.0)
            self.assertGreaterEqual(signal_payload["inventoryBias"], -1.0)
            self.assertLessEqual(signal_payload["inventoryBias"], 1.0)
            self.assertGreaterEqual(signal_payload["fairValueAdjBps"], -250.0)
            self.assertLessEqual(signal_payload["fairValueAdjBps"], 250.0)


if __name__ == "__main__":
    unittest.main()
