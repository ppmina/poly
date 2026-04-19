import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { FileSignalSource } from "../src/signals/fileSignalSource.js";
import { createNoopLogger } from "./helpers.js";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function writeSnapshotFixture(path: string, marketId = "market-neural", count = 48) {
  let midpoint = 0.42;
  const startTimestamp = 1_710_000_000_000;
  const rows: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const regime = Math.floor(index / 4) % 2 === 0 ? 1 : -1;
    const microSkew = ((index % 5) - 2) / 12;
    const spread = 0.018 + (index % 3) * 0.002;
    const imbalance = clamp(regime * 0.65 + microSkew, -0.92, 0.92);
    const bidSize = Number((95 + 40 * Math.max(imbalance, 0)).toFixed(4));
    const askSize = Number((95 + 40 * Math.max(-imbalance, 0)).toFixed(4));
    const depthBoost = Number((30 + Math.abs(imbalance) * 20).toFixed(4));
    const lastTradeDelta = regime * 0.006 + microSkew * 0.002;

    rows.push(
      JSON.stringify({
        marketId,
        tokenId: "token-neural",
        timestamp: startTimestamp + index * 30_000,
        bids: [
          { price: Number((midpoint - spread / 2).toFixed(6)), size: bidSize },
          {
            price: Number((midpoint - spread / 2 - 0.01).toFixed(6)),
            size: bidSize + depthBoost,
          },
          {
            price: Number((midpoint - spread / 2 - 0.02).toFixed(6)),
            size: bidSize + depthBoost * 1.5,
          },
        ],
        asks: [
          { price: Number((midpoint + spread / 2).toFixed(6)), size: askSize },
          {
            price: Number((midpoint + spread / 2 + 0.01).toFixed(6)),
            size: askSize + depthBoost,
          },
          {
            price: Number((midpoint + spread / 2 + 0.02).toFixed(6)),
            size: askSize + depthBoost * 1.5,
          },
        ],
        tickSize: 0.01,
        minOrderSize: 1,
        negRisk: false,
        lastTradePrice: Number(clamp(midpoint + lastTradeDelta, 0.05, 0.95).toFixed(6)),
        midpoint: Number(midpoint.toFixed(6)),
        bookHash: `book-${index}`,
        source: "replay",
      }),
    );

    const step = regime * 0.0014 + 0.0006 * microSkew + 0.0003 * (index % 7 < 3 ? 1 : -1);
    midpoint = clamp(midpoint + step, 0.08, 0.92);
  }

  await writeFile(path, `${rows.join("\n")}\n`, "utf8");
}

describe("Neural Signal Output", () => {
  it("produces a signal file that FileSignalSource can read without contract changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "poly-neural-signal-"));
    const inputPath = join(dir, "market-snapshots.jsonl");
    const outDir = join(dir, "model-output");
    const signalPath = join(dir, "signal.json");
    const pythonPath = join(repoRoot, ".venv", "bin", "python");

    await writeSnapshotFixture(inputPath);

    await execFileAsync(
      pythonPath,
      [
        join(repoRoot, "tools/research/train_signal_model.py"),
        "--input",
        inputPath,
        "--market",
        "market-neural",
        "--out-dir",
        outDir,
        "--epochs",
        "80",
        "--batch-size",
        "8",
        "--time-budget-seconds",
        "10",
      ],
      { cwd: repoRoot },
    );

    await execFileAsync(
      pythonPath,
      [
        join(repoRoot, "tools/research/generate_nn_signal.py"),
        "--input",
        inputPath,
        "--market",
        "market-neural",
        "--checkpoint",
        join(outDir, "best-checkpoint.npz"),
        "--output",
        signalPath,
      ],
      { cwd: repoRoot },
    );

    const signal = await new FileSignalSource(signalPath, 60_000, createNoopLogger()).read(
      "market-neural",
    );
    expect(signal).not.toBeNull();
    expect(signal?.marketId).toBe("market-neural");
    expect(signal?.confidence).toBeGreaterThanOrEqual(0);
    expect(signal?.confidence).toBeLessThanOrEqual(1);
  });
});
