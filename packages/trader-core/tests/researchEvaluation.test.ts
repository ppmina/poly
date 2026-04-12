import { describe, expect, it } from "vitest";

import {
  buildPredictionPoint,
  resolveEvaluation,
  settlePredictionQueue,
  type PredictionPoint,
} from "../src/research/evaluation.js";
import type { MarketSnapshot, SignalSnapshot } from "../src/types.js";

function makeSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    marketId: "market-1",
    tokenId: "token-1",
    timestamp: 1_710_000_000_000,
    bids: [{ price: 0.48, size: 100 }],
    asks: [{ price: 0.52, size: 50 }],
    tickSize: 0.01,
    minOrderSize: 1,
    negRisk: false,
    lastTradePrice: 0.5,
    midpoint: 0.5,
    bookHash: "hash-1",
    source: "live",
    ...overrides,
  };
}

function makeSignal(overrides: Partial<SignalSnapshot> = {}): SignalSnapshot {
  return {
    marketId: "market-1",
    timestamp: 1_710_000_000_000,
    fairValueAdjBps: 50,
    inventoryBias: 0.1,
    confidence: 0.85,
    ...overrides,
  };
}

function makePredictionPoint(overrides: Partial<PredictionPoint> = {}): PredictionPoint {
  return {
    predictedAt: 1_710_000_000_000,
    marketId: "market-1",
    midpointAtPrediction: 0.5,
    baseFairValue: 0.506667,
    predictionValue: 0.511667,
    confidence: 0.85,
    ...overrides,
  };
}

describe("research evaluation helpers", () => {
  it("builds an absolute prediction value and clamps it to market bounds", () => {
    const prediction = buildPredictionPoint(
      makeSnapshot({
        bids: [{ price: 0.97, size: 100 }],
        asks: [{ price: 0.99, size: 100 }],
        midpoint: 0.98,
      }),
      makeSignal({ fairValueAdjBps: 250 }),
    );

    expect(prediction?.baseFairValue).toBeCloseTo(0.98, 6);
    expect(prediction?.predictionValue).toBe(0.99);
  });

  it("returns null for cross-market predictions", () => {
    const prediction = buildPredictionPoint(makeSnapshot(), makeSignal({ marketId: "market-2" }));
    expect(prediction).toBeNull();
  });

  it("settles queued predictions only on the first midpoint at or after the truth horizon", () => {
    const pending = [
      makePredictionPoint({ predictedAt: 0 }),
      makePredictionPoint({ predictedAt: 30_000, predictionValue: 0.53 }),
    ];

    const beforeHorizon = settlePredictionQueue(
      pending,
      makeSnapshot({
        timestamp: 299_999,
        midpoint: 0.47,
      }),
      { truthHorizonMs: 300_000 },
    );

    expect(beforeHorizon.resolved).toHaveLength(0);
    expect(beforeHorizon.remaining).toHaveLength(2);

    const atHorizon = settlePredictionQueue(
      pending,
      makeSnapshot({
        timestamp: 300_000,
        midpoint: 0.49,
      }),
      { truthHorizonMs: 300_000 },
    );

    expect(atHorizon.resolved).toHaveLength(1);
    expect(atHorizon.resolved[0]?.truthValue).toBe(0.49);
    expect(atHorizon.remaining).toHaveLength(1);
  });

  it("treats the exact tolerance boundary as accurate", () => {
    const resolved = resolveEvaluation(makePredictionPoint({ predictionValue: 0.52 }), 0.5, 1, 0.02);
    expect(resolved.diff).toBe(0.02);
    expect(resolved.accurate).toBe(true);
  });
});
