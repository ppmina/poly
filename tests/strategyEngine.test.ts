import { describe, expect, it } from "vitest";

import { StrategyEngine } from "../src/strategy/strategyEngine.js";
import type {
  KillSwitchStatus,
  MarketSnapshot,
  PnLState,
  PositionState,
  SignalSnapshot,
} from "../src/types.js";
import { createNoopLogger } from "./helpers.js";

const snapshot: MarketSnapshot = {
  marketId: "market-1",
  tokenId: "token-1",
  timestamp: Date.now(),
  bids: [{ price: 0.48, size: 100 }],
  asks: [{ price: 0.52, size: 100 }],
  tickSize: 0.01,
  minOrderSize: 1,
  negRisk: false,
  lastTradePrice: 0.5,
  midpoint: 0.5,
  bookHash: "hash-1",
  source: "live",
};

const position: PositionState = {
  inventory: 0,
  averageEntryPrice: null,
  cash: 1_000,
  updatedAt: Date.now(),
};

const pnl: PnLState = {
  markPrice: 0.5,
  cash: 1_000,
  inventory: 0,
  averageEntryPrice: null,
  realizedPnl: 0,
  unrealizedPnl: 0,
  totalPnl: 0,
  grossExposure: 0,
};

const killSwitch: KillSwitchStatus = { triggered: false, reason: null };

function buildEngine(): StrategyEngine {
  return new StrategyEngine({
    baseSpreadBps: 200,
    quoteSize: 10,
    minQuoteSize: 1,
    inventorySkewBps: 100,
    riskLimits: {
      maxPosition: 20,
      maxNotional: 20,
      maxDrawdown: 5,
      staleDataMs: 10_000,
    },
    logger: createNoopLogger(),
  });
}

describe("StrategyEngine", () => {
  it("produces two-sided passive quotes when inside limits", () => {
    const decision = buildEngine().generateDecision({
      snapshot,
      position,
      pnl,
      signal: null,
      killSwitch,
    });

    expect(decision.intents).toHaveLength(2);
    expect(decision.intents[0]?.price).toBeLessThan(decision.intents[1]?.price ?? 1);
  });

  it("stops quoting on stale data", () => {
    const decision = buildEngine().generateDecision({
      snapshot: {
        ...snapshot,
        timestamp: Date.now() - 60_000,
      },
      position,
      pnl,
      signal: null,
      killSwitch,
    });

    expect(decision.intents).toHaveLength(0);
    expect(decision.reasons).toContain("stale_market_data");
  });

  it("skips bids when already at the long inventory cap", () => {
    const decision = buildEngine().generateDecision({
      snapshot,
      position: {
        ...position,
        inventory: 20,
      },
      pnl,
      signal: null,
      killSwitch,
    });

    expect(decision.intents.some((intent) => intent.side === "buy")).toBe(false);
    expect(decision.intents.some((intent) => intent.side === "sell")).toBe(true);
  });

  it("moves fair value toward the signal adjustment", () => {
    const signal: SignalSnapshot = {
      marketId: "market-1",
      timestamp: Date.now(),
      fairValueAdjBps: 50,
      inventoryBias: 0.2,
      confidence: 1,
    };

    const decision = buildEngine().generateDecision({
      snapshot,
      position,
      pnl,
      signal,
      killSwitch,
    });

    expect(decision.adjustedFairValue).not.toBeNull();
    expect((decision.adjustedFairValue ?? 0) > (decision.baseFairValue ?? 0)).toBe(true);
  });
});
