import { describe, expect, it } from "vitest";

import { estimateFairValue } from "../src/strategy/fairValue.js";
import type { MarketSnapshot } from "../src/types.js";

function makeSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    marketId: "market-1",
    tokenId: "token-1",
    timestamp: Date.now(),
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

describe("estimateFairValue", () => {
  it("uses midpoint plus depth imbalance skew", () => {
    const estimate = estimateFairValue(makeSnapshot());
    expect(estimate.fairValue).toBeCloseTo(0.506667, 5);
    expect(estimate.spread).toBeCloseTo(0.04, 6);
  });

  it("falls back to single-sided books", () => {
    const estimate = estimateFairValue(
      makeSnapshot({
        asks: [],
        midpoint: null,
      }),
    );

    expect(estimate.fairValue).toBe(0.49);
    expect(estimate.spread).toBeNull();
  });
});
