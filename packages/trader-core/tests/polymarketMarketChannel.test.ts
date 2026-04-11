import { describe, expect, it } from "vitest";

import {
  applyMarketChannelBookEvent,
  applyMarketChannelLastTradePriceEvent,
  applyMarketChannelPriceChangeEvent,
  applyMarketChannelTickSizeChangeEvent,
  createMarketChannelState,
  toMarketSnapshot,
} from "../src/gateways/polymarketMarketChannel.js";
import type { MarketSnapshot } from "../src/types.js";

function buildSnapshot(): MarketSnapshot {
  return {
    marketId: "market-1",
    tokenId: "token-1",
    timestamp: 1_700_000_000_000,
    bids: [
      { price: 0.53, size: 20 },
      { price: 0.52, size: 14 },
    ],
    asks: [
      { price: 0.54, size: 15 },
      { price: 0.55, size: 18 },
    ],
    tickSize: 0.01,
    minOrderSize: 1,
    negRisk: false,
    lastTradePrice: 0.535,
    midpoint: 0.535,
    bookHash: "hash-1",
    source: "live",
  };
}

describe("polymarketMarketChannel helpers", () => {
  it("replaces the local book from a book event", () => {
    const state = applyMarketChannelBookEvent(createMarketChannelState(buildSnapshot()), {
      event_type: "book",
      asset_id: "token-1",
      market: "market-1",
      bids: [{ price: "0.60", size: "8" }],
      asks: [{ price: "0.61", size: "10" }],
      timestamp: "1700000001000",
      hash: "hash-2",
    });

    const snapshot = toMarketSnapshot(state);
    expect(snapshot.bids).toEqual([{ price: 0.6, size: 8 }]);
    expect(snapshot.asks).toEqual([{ price: 0.61, size: 10 }]);
    expect(snapshot.bookHash).toBe("hash-2");
    expect(snapshot.midpoint).toBe(0.605);
  });

  it("updates and removes price levels from price_change events", () => {
    const state = applyMarketChannelPriceChangeEvent(createMarketChannelState(buildSnapshot()), {
      event_type: "price_change",
      price_changes: [
        {
          asset_id: "token-1",
          market: "market-1",
          side: "BUY",
          price: "0.53",
          size: "0",
          timestamp: "1700000002000",
          hash: "hash-3",
        },
        {
          asset_id: "token-1",
          market: "market-1",
          side: "SELL",
          price: "0.545",
          size: "9",
          timestamp: "1700000002000",
          hash: "hash-3",
        },
      ],
    });

    const snapshot = toMarketSnapshot(state);
    expect(snapshot.bids).toEqual([{ price: 0.52, size: 14 }]);
    expect(snapshot.asks).toEqual([
      { price: 0.54, size: 15 },
      { price: 0.545, size: 9 },
      { price: 0.55, size: 18 },
    ]);
    expect(snapshot.bookHash).toBe("hash-3");
  });

  it("updates tick size without changing order book levels", () => {
    const original = createMarketChannelState(buildSnapshot());
    const updated = applyMarketChannelTickSizeChangeEvent(original, {
      event_type: "tick_size_change",
      asset_id: "token-1",
      new_tick_size: "0.001",
      timestamp: "1700000003000",
    });

    const snapshot = toMarketSnapshot(updated);
    expect(snapshot.tickSize).toBe(0.001);
    expect(snapshot.bids).toEqual(buildSnapshot().bids);
    expect(snapshot.asks).toEqual(buildSnapshot().asks);
  });

  it("updates last trade price without mutating the book", () => {
    const original = createMarketChannelState(buildSnapshot());
    const updated = applyMarketChannelLastTradePriceEvent(original, {
      event_type: "last_trade_price",
      asset_id: "token-1",
      price: "0.549",
      timestamp: "1700000004000",
    });

    const snapshot = toMarketSnapshot(updated);
    expect(snapshot.lastTradePrice).toBe(0.549);
    expect(snapshot.bids).toEqual(buildSnapshot().bids);
    expect(snapshot.asks).toEqual(buildSnapshot().asks);
  });
});
