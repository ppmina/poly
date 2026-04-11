import { randomUUID } from "node:crypto";

import type { JsonlArtifactStore } from "../artifacts/jsonlArtifactStore.js";
import type { Logger } from "../logger.js";
import type {
  ExecutionResult,
  FillEvent,
  MarketSnapshot,
  OrderState,
  PnLState,
  PositionState,
  QuoteIntent,
} from "../types.js";
import { asFixedNumber, bpsToPrice, nearlyEqual } from "../utils/number.js";
import type { ExecutionAdapter } from "./executionAdapter.js";

interface PaperExecutorOptions {
  initialCash: number;
  fillSlippageBps: number;
  artifactStore: JsonlArtifactStore;
  logger: Logger;
}

interface PaperState {
  inventory: number;
  averageEntryPrice: number | null;
  cash: number;
  realizedPnl: number;
  lastMarkPrice: number | null;
  updatedAt: number;
}

export class PaperExecutor implements ExecutionAdapter {
  private readonly orders = new Map<string, OrderState>();
  private readonly state: PaperState;

  public constructor(private readonly options: PaperExecutorOptions) {
    this.state = {
      inventory: 0,
      averageEntryPrice: null,
      cash: options.initialCash,
      realizedPnl: 0,
      lastMarkPrice: null,
      updatedAt: Date.now(),
    };
  }

  public async getOpenOrders(): Promise<OrderState[]> {
    return [...this.orders.values()]
      .filter((order) => order.status === "open")
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  public async getPositionState(): Promise<PositionState> {
    return {
      inventory: this.state.inventory,
      averageEntryPrice: this.state.averageEntryPrice,
      cash: this.state.cash,
      updatedAt: this.state.updatedAt,
    };
  }

  public async getPnLState(markPrice = this.state.lastMarkPrice): Promise<PnLState> {
    const effectiveMark = markPrice ?? this.state.lastMarkPrice;
    const totalPnl =
      effectiveMark === null
        ? this.state.cash - this.options.initialCash
        : this.state.cash + this.state.inventory * effectiveMark - this.options.initialCash;
    const unrealizedPnl = totalPnl - this.state.realizedPnl;

    return {
      markPrice: effectiveMark ?? null,
      cash: asFixedNumber(this.state.cash, 8),
      inventory: asFixedNumber(this.state.inventory, 8),
      averageEntryPrice: this.state.averageEntryPrice,
      realizedPnl: asFixedNumber(this.state.realizedPnl, 8),
      unrealizedPnl: asFixedNumber(unrealizedPnl, 8),
      totalPnl: asFixedNumber(totalPnl, 8),
      grossExposure:
        effectiveMark === null
          ? 0
          : asFixedNumber(Math.abs(this.state.inventory * effectiveMark), 8),
    };
  }

  public async applyQuoteIntents(
    intents: QuoteIntent[],
    snapshot: MarketSnapshot,
  ): Promise<ExecutionResult> {
    this.state.lastMarkPrice =
      snapshot.midpoint ?? snapshot.lastTradePrice ?? this.state.lastMarkPrice;
    this.state.updatedAt = Date.now();

    const cancelledOrderIds = await this.reconcileOrders(intents, snapshot.timestamp);
    const fills = await this.simulateFills(snapshot);

    return {
      orders: await this.getOpenOrders(),
      fills,
      position: await this.getPositionState(),
      pnl: await this.getPnLState(this.state.lastMarkPrice),
      cancelledOrderIds,
    };
  }

  public async shutdown(): Promise<void> {
    const openOrders = await this.getOpenOrders();
    for (const order of openOrders) {
      order.status = "cancelled";
      order.updatedAt = Date.now();
      await this.recordOrderEvent("shutdown_cancel", order);
    }
  }

  private async reconcileOrders(intents: QuoteIntent[], timestamp: number): Promise<string[]> {
    const desiredBySide = new Map(intents.map((intent) => [intent.side, intent]));
    const cancelledOrderIds: string[] = [];
    const currentOrders = await this.getOpenOrders();

    for (const order of currentOrders) {
      const desired = desiredBySide.get(order.side);
      if (!desired || !matchesIntent(order, desired)) {
        order.status = "cancelled";
        order.updatedAt = timestamp;
        cancelledOrderIds.push(order.orderId);
        await this.recordOrderEvent("cancel", order);
      }
    }

    const remainingOpenOrders = await this.getOpenOrders();

    for (const intent of intents) {
      const existing = remainingOpenOrders.find(
        (order) => order.side === intent.side && matchesIntent(order, intent),
      );
      if (existing) {
        continue;
      }

      const order: OrderState = {
        orderId: randomUUID(),
        marketId: intent.marketId,
        tokenId: intent.tokenId,
        side: intent.side,
        price: intent.price,
        size: intent.size,
        remainingSize: intent.size,
        status: "open",
        executionMode: "paper",
        createdAt: timestamp,
        updatedAt: timestamp,
        note: intent.reason,
      };

      this.orders.set(order.orderId, order);
      await this.recordOrderEvent("create", order);
    }

    return cancelledOrderIds;
  }

  private async simulateFills(snapshot: MarketSnapshot): Promise<FillEvent[]> {
    const fills: FillEvent[] = [];
    const openOrders = await this.getOpenOrders();

    for (const order of openOrders) {
      const level = order.side === "buy" ? snapshot.asks[0] : snapshot.bids[0];
      if (!level) {
        continue;
      }

      const crosses =
        order.side === "buy" ? level.price <= order.price : level.price >= order.price;
      if (!crosses) {
        continue;
      }

      const slippage = bpsToPrice(this.options.fillSlippageBps);
      const fillPrice =
        order.side === "buy"
          ? Math.min(order.price, level.price + slippage)
          : Math.max(order.price, level.price - slippage);
      const fillSize = Math.min(order.remainingSize, level.size);

      if (fillSize <= 0) {
        continue;
      }

      order.remainingSize = asFixedNumber(order.remainingSize - fillSize, 8);
      order.updatedAt = snapshot.timestamp;
      if (order.remainingSize <= 1e-9) {
        order.remainingSize = 0;
        order.status = "filled";
      }

      const fill = this.applyFill(
        order,
        fillPrice,
        fillSize,
        snapshot.timestamp,
        "top_of_book_touch",
      );
      fills.push(fill);

      await this.recordOrderEvent("fill", order);
      await this.options.artifactStore.append("fills", fill);
    }

    return fills;
  }

  private applyFill(
    order: OrderState,
    price: number,
    size: number,
    timestamp: number,
    reason: string,
  ): FillEvent {
    const signedSize = order.side === "buy" ? size : -size;
    const cashDelta = order.side === "buy" ? -price * size : price * size;
    const inventoryBefore = this.state.inventory;
    const inventoryAfter = asFixedNumber(inventoryBefore + signedSize, 8);

    this.state.cash = asFixedNumber(this.state.cash + cashDelta, 8);
    this.state.realizedPnl = asFixedNumber(
      this.state.realizedPnl +
        calculateRealizedPnl(inventoryBefore, this.state.averageEntryPrice, signedSize, price),
      8,
    );
    this.state.inventory = inventoryAfter;
    this.state.averageEntryPrice = nextAverageEntryPrice(
      inventoryBefore,
      this.state.averageEntryPrice,
      signedSize,
      price,
    );
    this.state.updatedAt = timestamp;

    const fill: FillEvent = {
      fillId: randomUUID(),
      orderId: order.orderId,
      marketId: order.marketId,
      tokenId: order.tokenId,
      side: order.side,
      price: asFixedNumber(price, 8),
      size: asFixedNumber(size, 8),
      timestamp,
      cashDelta: asFixedNumber(cashDelta, 8),
      inventoryAfter,
      reason,
    };

    this.options.logger.info("Paper fill simulated", {
      orderId: order.orderId,
      side: order.side,
      price: fill.price,
      size: fill.size,
      inventoryAfter: fill.inventoryAfter,
    });

    return fill;
  }

  private async recordOrderEvent(eventType: string, order: OrderState): Promise<void> {
    await this.options.artifactStore.append("orders", {
      eventType,
      order,
      recordedAt: new Date().toISOString(),
    });
  }
}

function matchesIntent(order: OrderState, intent: QuoteIntent): boolean {
  return (
    order.status === "open" &&
    nearlyEqual(order.price, intent.price) &&
    nearlyEqual(order.size, intent.size)
  );
}

function calculateRealizedPnl(
  inventoryBefore: number,
  averageEntryPrice: number | null,
  signedFillSize: number,
  fillPrice: number,
): number {
  if (
    inventoryBefore === 0 ||
    averageEntryPrice === null ||
    Math.sign(inventoryBefore) === Math.sign(signedFillSize)
  ) {
    return 0;
  }

  const closedSize = Math.min(Math.abs(inventoryBefore), Math.abs(signedFillSize));
  return closedSize * (fillPrice - averageEntryPrice) * Math.sign(inventoryBefore);
}

function nextAverageEntryPrice(
  inventoryBefore: number,
  averageEntryPrice: number | null,
  signedFillSize: number,
  fillPrice: number,
): number | null {
  const inventoryAfter = inventoryBefore + signedFillSize;
  if (Math.abs(inventoryAfter) <= 1e-9) {
    return null;
  }

  if (
    inventoryBefore === 0 ||
    averageEntryPrice === null ||
    Math.sign(inventoryBefore) === Math.sign(signedFillSize)
  ) {
    const existingNotional = Math.abs(inventoryBefore) * (averageEntryPrice ?? fillPrice);
    const newNotional = Math.abs(signedFillSize) * fillPrice;
    const totalSize = Math.abs(inventoryAfter);
    return asFixedNumber((existingNotional + newNotional) / totalSize, 8);
  }

  if (Math.sign(inventoryAfter) === Math.sign(inventoryBefore)) {
    return averageEntryPrice;
  }

  return asFixedNumber(fillPrice, 8);
}
