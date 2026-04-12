import { describe, expect, it } from "vitest";

import type { MarketSnapshot, SignalSnapshot } from "@poly/trader-core/types";

import { ResearchDashboardModel } from "./research-dashboard";

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
    fairValueAdjBps: 25,
    inventoryBias: 0,
    confidence: 0.9,
    ...overrides,
  };
}

describe("ResearchDashboardModel", () => {
  it("shapes state when predictions exist but no truths have resolved yet", () => {
    const model = new ResearchDashboardModel({
      marketId: "market-1",
      tokenId: "token-1",
    });

    model.handleSnapshot(makeSnapshot(), makeSignal());
    const state = model.buildState();

    expect(state.connectionState).toBe("live");
    expect(state.latestPrediction?.predictionValue).toBeDefined();
    expect(state.pendingCount).toBe(1);
    expect(state.recentEvaluations).toHaveLength(0);
    expect(state.rollingAccuracy).toBeNull();
  });

  it("keeps the pending queue active until truths resolve at the configured horizon", () => {
    const model = new ResearchDashboardModel({
      marketId: "market-1",
      tokenId: "token-1",
    });

    model.handleSnapshot(makeSnapshot({ timestamp: 0 }), makeSignal({ timestamp: 0 }));
    model.handleSnapshot(
      makeSnapshot({ timestamp: 30_000, midpoint: 0.51 }),
      makeSignal({ timestamp: 30_000 }),
    );
    const pendingState = model.buildState();

    expect(pendingState.pendingCount).toBe(2);
    expect(pendingState.recentEvaluations).toHaveLength(0);

    model.handleSnapshot(
      makeSnapshot({ timestamp: 300_000, midpoint: 0.49 }),
      makeSignal({ timestamp: 300_000 }),
    );
    const resolvedState = model.buildState();

    expect(resolvedState.pendingCount).toBe(2);
    expect(resolvedState.recentEvaluations).toHaveLength(1);
    expect(resolvedState.latestResolved?.truthValue).toBe(0.49);
  });

  it("does not emit scorable predictions when the signal is unavailable", () => {
    const model = new ResearchDashboardModel({
      marketId: "market-1",
      tokenId: "token-1",
    });

    model.handleSnapshot(makeSnapshot(), null);
    const state = model.buildState();

    expect(state.latestPrediction).toBeNull();
    expect(state.pendingCount).toBe(0);
    expect(state.signalState.status).toBe("unavailable");
  });

  it("moves into reconnecting after a live stream interruption", () => {
    const model = new ResearchDashboardModel({
      marketId: "market-1",
      tokenId: "token-1",
    });

    model.handleSnapshot(makeSnapshot(), makeSignal());
    model.markStreamInterrupted();

    expect(model.buildState().connectionState).toBe("reconnecting");
  });

  it("uses an error state when the feed interrupts before any live snapshot arrives", () => {
    const model = new ResearchDashboardModel({
      marketId: "market-1",
      tokenId: "token-1",
    });

    model.markStreamInterrupted();

    expect(model.buildState().connectionState).toBe("error");
  });
});
