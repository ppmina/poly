import type { Logger } from "../logger.js";
import type {
  ExecutionResult,
  MarketSnapshot,
  PnLState,
  PositionState,
  QuoteIntent,
} from "../types.js";
import type { PolymarketGateway } from "../gateways/polymarketGateway.js";
import type { ExecutionAdapter } from "./executionAdapter.js";

export class LiveExecutor implements ExecutionAdapter {
  public constructor(
    private readonly gateway: PolymarketGateway,
    private readonly logger: Logger,
    private readonly allowLiveExecution: boolean,
  ) {}

  public async getOpenOrders() {
    return this.gateway.listOpenOrders();
  }

  public async getPositionState(): Promise<PositionState> {
    return {
      inventory: 0,
      averageEntryPrice: null,
      cash: 0,
      updatedAt: Date.now(),
    };
  }

  public async getPnLState(markPrice?: number | null): Promise<PnLState> {
    return {
      markPrice: markPrice ?? null,
      cash: 0,
      inventory: 0,
      averageEntryPrice: null,
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      grossExposure: 0,
    };
  }

  public async applyQuoteIntents(
    intents: QuoteIntent[],
    snapshot: MarketSnapshot,
  ): Promise<ExecutionResult> {
    if (!this.allowLiveExecution) {
      throw new Error("Live execution is disabled. Set ALLOW_LIVE_EXECUTION=true to enable it.");
    }

    await this.gateway.cancelOpenOrders();
    const orders = await this.gateway.submitQuoteIntents(intents);

    this.logger.warn("Submitted live quote intents", {
      count: intents.length,
      marketId: snapshot.marketId,
      tokenId: snapshot.tokenId,
    });

    return {
      orders,
      fills: [],
      position: await this.getPositionState(),
      pnl: await this.getPnLState(snapshot.midpoint ?? snapshot.lastTradePrice),
      cancelledOrderIds: [],
    };
  }

  public async shutdown(): Promise<void> {
    if (this.allowLiveExecution) {
      await this.gateway.cancelOpenOrders();
    }
  }
}
