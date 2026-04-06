import { randomUUID } from "node:crypto";

import type { Logger } from "../logger.js";
import type {
  KillSwitchStatus,
  MarketSnapshot,
  PnLState,
  PositionState,
  QuoteIntent,
  RiskLimits,
  SignalSnapshot,
  StrategyDecision,
} from "../types.js";
import { bpsToPrice, clamp, roundDownToTick, roundUpToTick } from "../utils/number.js";
import { estimateFairValue } from "./fairValue.js";

interface StrategyEngineOptions {
  baseSpreadBps: number;
  quoteSize: number;
  minQuoteSize: number;
  inventorySkewBps: number;
  riskLimits: RiskLimits;
  logger: Logger;
}

interface StrategyInput {
  snapshot: MarketSnapshot;
  position: PositionState;
  pnl: PnLState;
  signal: SignalSnapshot | null;
  killSwitch: KillSwitchStatus;
  now?: number;
}

export class StrategyEngine {
  public constructor(private readonly options: StrategyEngineOptions) {}

  public generateDecision(input: StrategyInput): StrategyDecision {
    const now = input.now ?? Date.now();
    const reasons: string[] = [];

    if (input.killSwitch.triggered) {
      reasons.push(input.killSwitch.reason ?? "kill_switch_triggered");
      return this.noQuoteDecision(input.signal, reasons, true);
    }

    if (now - input.snapshot.timestamp > this.options.riskLimits.staleDataMs) {
      reasons.push("stale_market_data");
      return this.noQuoteDecision(input.signal, reasons, false);
    }

    if (input.pnl.totalPnl <= -this.options.riskLimits.maxDrawdown) {
      reasons.push("drawdown_limit_reached");
      return this.noQuoteDecision(input.signal, reasons, false);
    }

    const estimate = estimateFairValue(input.snapshot);
    if (estimate.fairValue === null) {
      reasons.push("no_fair_value");
      return this.noQuoteDecision(input.signal, reasons, false);
    }

    const signalAdjustmentBps = input.signal
      ? input.signal.fairValueAdjBps * input.signal.confidence
      : 0;
    const desiredInventory = input.signal
      ? input.signal.inventoryBias * this.options.riskLimits.maxPosition * input.signal.confidence
      : 0;
    const inventoryGap = input.position.inventory - desiredInventory;
    const inventoryAdjustmentBps =
      (inventoryGap / this.options.riskLimits.maxPosition) * this.options.inventorySkewBps;
    const adjustedFairValue = clamp(
      estimate.fairValue + bpsToPrice(signalAdjustmentBps - inventoryAdjustmentBps),
      input.snapshot.tickSize,
      1 - input.snapshot.tickSize,
    );

    const halfSpread = Math.max(
      bpsToPrice(this.options.baseSpreadBps) / 2,
      input.snapshot.tickSize / 2,
    );
    let bidPrice = roundDownToTick(adjustedFairValue - halfSpread, input.snapshot.tickSize);
    let askPrice = roundUpToTick(adjustedFairValue + halfSpread, input.snapshot.tickSize);
    bidPrice = clamp(bidPrice, input.snapshot.tickSize, 1 - 2 * input.snapshot.tickSize);
    askPrice = clamp(askPrice, bidPrice + input.snapshot.tickSize, 1 - input.snapshot.tickSize);

    const maxInventoryByNotional =
      this.options.riskLimits.maxNotional / Math.max(adjustedFairValue, input.snapshot.tickSize);
    const bidCapacity = Math.max(
      0,
      Math.min(
        this.options.riskLimits.maxPosition - input.position.inventory,
        maxInventoryByNotional - input.position.inventory,
      ),
    );
    const askCapacity = Math.max(
      0,
      Math.min(
        this.options.riskLimits.maxPosition + input.position.inventory,
        maxInventoryByNotional + input.position.inventory,
      ),
    );

    const confidenceScale = input.signal ? clamp(0.5 + input.signal.confidence / 2, 0.5, 1) : 1;
    const desiredSize = Math.max(
      this.options.quoteSize * confidenceScale,
      this.options.minQuoteSize,
    );
    const intents: QuoteIntent[] = [];

    if (bidCapacity >= this.options.minQuoteSize) {
      intents.push(
        this.createIntent(
          "buy",
          input.snapshot,
          bidPrice,
          Math.min(desiredSize, bidCapacity),
          `passive_mm_bid|fair=${adjustedFairValue.toFixed(4)}`,
        ),
      );
    } else {
      reasons.push("bid_capacity_exhausted");
    }

    if (askCapacity >= this.options.minQuoteSize) {
      intents.push(
        this.createIntent(
          "sell",
          input.snapshot,
          askPrice,
          Math.min(desiredSize, askCapacity),
          `passive_mm_ask|fair=${adjustedFairValue.toFixed(4)}`,
        ),
      );
    } else {
      reasons.push("ask_capacity_exhausted");
    }

    if (intents.length === 0) {
      reasons.push("no_quote_capacity");
    }

    this.options.logger.debug("Generated strategy decision", {
      marketId: input.snapshot.marketId,
      tokenId: input.snapshot.tokenId,
      fairValue: estimate.fairValue,
      adjustedFairValue,
      inventory: input.position.inventory,
      signalConfidence: input.signal?.confidence ?? null,
      intents: intents.length,
    });

    return {
      baseFairValue: estimate.fairValue,
      adjustedFairValue,
      intents,
      reasons,
      signal: input.signal,
      killSwitchTriggered: false,
    };
  }

  private createIntent(
    side: "buy" | "sell",
    snapshot: MarketSnapshot,
    price: number,
    size: number,
    reason: string,
  ): QuoteIntent {
    return {
      intentId: randomUUID(),
      marketId: snapshot.marketId,
      tokenId: snapshot.tokenId,
      side,
      price,
      size,
      createdAt: Date.now(),
      reason,
    };
  }

  private noQuoteDecision(
    signal: SignalSnapshot | null,
    reasons: string[],
    killSwitchTriggered: boolean,
  ): StrategyDecision {
    return {
      baseFairValue: null,
      adjustedFairValue: null,
      intents: [],
      reasons,
      signal,
      killSwitchTriggered,
    };
  }
}
