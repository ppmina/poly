import type { OpenOrder, OrderBookSummary } from "@polymarket/clob-client";

import type {
  ExecutionMode,
  MarketSnapshot,
  OrderState,
  QuoteIntent,
  QuoteSide,
  SnapshotSource,
} from "../types.js";
import { asFixedNumber } from "../utils/number.js";

export interface MarketDataSubscription {
  stop(): Promise<void> | void;
}

export interface PolymarketGateway {
  connectMarketData(
    listener: (snapshot: MarketSnapshot) => Promise<void> | void,
    onError?: (error: unknown) => void,
  ): Promise<MarketDataSubscription>;
  getBookSnapshot(): Promise<MarketSnapshot>;
  listOpenOrders(): Promise<OrderState[]>;
  submitQuoteIntents(intents: QuoteIntent[]): Promise<OrderState[]>;
  cancelOpenOrders(orderIds?: string[]): Promise<void>;
}

export function normalizeOrderBook(
  summary: OrderBookSummary,
  source: SnapshotSource = "live",
): MarketSnapshot {
  const bids = summary.bids
    .map((level) => ({
      price: Number(level.price),
      size: Number(level.size),
    }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size))
    .sort((left, right) => right.price - left.price);

  const asks = summary.asks
    .map((level) => ({
      price: Number(level.price),
      size: Number(level.size),
    }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size))
    .sort((left, right) => left.price - right.price);

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const midpoint =
    bestBid !== null && bestAsk !== null ? asFixedNumber((bestBid + bestAsk) / 2, 6) : null;

  return {
    marketId: summary.market,
    tokenId: summary.asset_id,
    timestamp: normalizeTimestamp(summary.timestamp),
    bids,
    asks,
    tickSize: Number(summary.tick_size),
    minOrderSize: Number(summary.min_order_size),
    negRisk: summary.neg_risk,
    lastTradePrice: safeNumber(summary.last_trade_price),
    midpoint,
    bookHash: summary.hash ?? null,
    source,
  };
}

export function normalizeOpenOrder(
  order: OpenOrder,
  executionMode: ExecutionMode = "live",
): OrderState {
  const side = normalizeSide(order.side);
  const size = Number(order.original_size);
  const matched = Number(order.size_matched);

  return {
    orderId: order.id,
    marketId: order.market,
    tokenId: order.asset_id,
    side,
    price: Number(order.price),
    size,
    remainingSize: Math.max(size - matched, 0),
    status: normalizeOrderStatus(order.status),
    executionMode,
    createdAt: order.created_at,
    updatedAt: order.created_at,
    note: order.outcome,
  };
}

export function normalizeSide(value: string): QuoteSide {
  const normalized = value.trim().toLowerCase();
  if (normalized === "buy") {
    return "buy";
  }

  return "sell";
}

function normalizeOrderStatus(value: string): "open" | "filled" | "cancelled" {
  const normalized = value.trim().toLowerCase();
  if (["matched", "filled", "executed"].includes(normalized)) {
    return "filled";
  }

  if (["cancelled", "canceled", "expired"].includes(normalized)) {
    return "cancelled";
  }

  return "open";
}

function normalizeTimestamp(value: string): number {
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }

  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) {
    return asDate;
  }

  return Date.now();
}

function safeNumber(value: string | null | undefined): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
