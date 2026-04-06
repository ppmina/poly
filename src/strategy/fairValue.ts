import type { MarketSnapshot } from "../types.js";
import { asFixedNumber, clamp } from "../utils/number.js";

export interface FairValueEstimate {
  fairValue: number | null;
  spread: number | null;
  imbalance: number;
}

export function estimateFairValue(snapshot: MarketSnapshot): FairValueEstimate {
  const bestBid = snapshot.bids[0];
  const bestAsk = snapshot.asks[0];

  if (bestBid && bestAsk) {
    const midpoint = (bestBid.price + bestAsk.price) / 2;
    const spread = bestAsk.price - bestBid.price;
    const bidDepth = sumDepth(snapshot.bids, 3);
    const askDepth = sumDepth(snapshot.asks, 3);
    const imbalance = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;
    const skew = imbalance * Math.min(spread / 2, 0.02);

    return {
      fairValue: clamp(asFixedNumber(midpoint + skew, 6), snapshot.tickSize, 1 - snapshot.tickSize),
      spread: asFixedNumber(spread, 6),
      imbalance: asFixedNumber(imbalance, 6),
    };
  }

  if (bestBid) {
    return {
      fairValue: clamp(
        asFixedNumber(bestBid.price + snapshot.tickSize, 6),
        snapshot.tickSize,
        1 - snapshot.tickSize,
      ),
      spread: null,
      imbalance: 1,
    };
  }

  if (bestAsk) {
    return {
      fairValue: clamp(
        asFixedNumber(bestAsk.price - snapshot.tickSize, 6),
        snapshot.tickSize,
        1 - snapshot.tickSize,
      ),
      spread: null,
      imbalance: -1,
    };
  }

  if (snapshot.lastTradePrice !== null) {
    return {
      fairValue: clamp(
        asFixedNumber(snapshot.lastTradePrice, 6),
        snapshot.tickSize,
        1 - snapshot.tickSize,
      ),
      spread: null,
      imbalance: 0,
    };
  }

  return {
    fairValue: null,
    spread: null,
    imbalance: 0,
  };
}

function sumDepth(levels: MarketSnapshot["bids"], depth: number): number {
  return levels.slice(0, depth).reduce((total, level) => total + level.size, 0);
}
