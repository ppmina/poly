import type { BookLevel, MarketSnapshot, SnapshotSource } from "../types.js";
import { asFixedNumber } from "../utils/number.js";

export interface MarketChannelBookLevel {
  price: string;
  size: string;
}

export interface MarketChannelBookEvent {
  event_type: "book";
  asset_id: string;
  market: string;
  bids: MarketChannelBookLevel[];
  asks: MarketChannelBookLevel[];
  timestamp: string;
  hash?: string | null;
}

export interface MarketChannelPriceChange {
  asset_id: string;
  market?: string;
  side: string;
  price: string;
  size: string;
  timestamp?: string;
  hash?: string | null;
}

export interface MarketChannelPriceChangeEvent {
  event_type: "price_change";
  price_changes: MarketChannelPriceChange[];
}

export interface MarketChannelTickSizeChangeEvent {
  event_type: "tick_size_change";
  asset_id: string;
  market?: string;
  old_tick_size?: string;
  new_tick_size: string;
  timestamp?: string;
}

export interface MarketChannelLastTradePriceEvent {
  event_type: "last_trade_price";
  asset_id: string;
  market?: string;
  price: string;
  timestamp?: string;
}

export type MarketChannelEvent =
  | MarketChannelBookEvent
  | MarketChannelPriceChangeEvent
  | MarketChannelTickSizeChangeEvent
  | MarketChannelLastTradePriceEvent;

export interface MarketChannelState {
  marketId: string;
  tokenId: string;
  bids: Map<number, number>;
  asks: Map<number, number>;
  timestamp: number;
  tickSize: number;
  minOrderSize: number;
  negRisk: boolean;
  lastTradePrice: number | null;
  bookHash: string | null;
}

export function createMarketChannelState(snapshot: MarketSnapshot): MarketChannelState {
  return {
    marketId: snapshot.marketId,
    tokenId: snapshot.tokenId,
    bids: createBookMap(snapshot.bids),
    asks: createBookMap(snapshot.asks),
    timestamp: snapshot.timestamp,
    tickSize: snapshot.tickSize,
    minOrderSize: snapshot.minOrderSize,
    negRisk: snapshot.negRisk,
    lastTradePrice: snapshot.lastTradePrice,
    bookHash: snapshot.bookHash,
  };
}

export function toMarketSnapshot(
  state: MarketChannelState,
  source: SnapshotSource = "live",
): MarketSnapshot {
  const bids = toSortedLevels(state.bids, "buy");
  const asks = toSortedLevels(state.asks, "sell");
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const midpoint =
    bestBid !== null && bestAsk !== null ? asFixedNumber((bestBid + bestAsk) / 2, 6) : null;

  return {
    marketId: state.marketId,
    tokenId: state.tokenId,
    timestamp: state.timestamp,
    bids,
    asks,
    tickSize: state.tickSize,
    minOrderSize: state.minOrderSize,
    negRisk: state.negRisk,
    lastTradePrice: state.lastTradePrice,
    midpoint,
    bookHash: state.bookHash,
    source,
  };
}

export function applyMarketChannelBookEvent(
  state: MarketChannelState,
  event: MarketChannelBookEvent,
): MarketChannelState {
  return {
    ...state,
    marketId: event.market,
    tokenId: event.asset_id,
    bids: createBookMap(event.bids),
    asks: createBookMap(event.asks),
    timestamp: normalizeTimestamp(event.timestamp),
    bookHash: event.hash ?? null,
  };
}

export function applyMarketChannelPriceChangeEvent(
  state: MarketChannelState,
  event: MarketChannelPriceChangeEvent,
): MarketChannelState {
  const nextState = cloneMarketChannelState(state);
  let changed = false;

  for (const change of event.price_changes) {
    if (change.asset_id !== state.tokenId) {
      continue;
    }

    const price = safeNumber(change.price);
    const size = safeNumber(change.size);
    if (price === null || size === null) {
      continue;
    }

    const bookSide = normalizeSide(change.side) === "buy" ? nextState.bids : nextState.asks;
    if (size <= 0) {
      bookSide.delete(price);
    } else {
      bookSide.set(price, size);
    }

    nextState.marketId = change.market ?? nextState.marketId;
    nextState.timestamp =
      change.timestamp !== undefined ? normalizeTimestamp(change.timestamp) : nextState.timestamp;
    nextState.bookHash = change.hash ?? nextState.bookHash;
    changed = true;
  }

  return changed ? nextState : state;
}

export function applyMarketChannelTickSizeChangeEvent(
  state: MarketChannelState,
  event: MarketChannelTickSizeChangeEvent,
): MarketChannelState {
  const tickSize = safeNumber(event.new_tick_size);
  if (tickSize === null) {
    return state;
  }

  return {
    ...state,
    marketId: event.market ?? state.marketId,
    tickSize,
    timestamp:
      event.timestamp !== undefined ? normalizeTimestamp(event.timestamp) : state.timestamp,
  };
}

export function applyMarketChannelLastTradePriceEvent(
  state: MarketChannelState,
  event: MarketChannelLastTradePriceEvent,
): MarketChannelState {
  const lastTradePrice = safeNumber(event.price);
  if (lastTradePrice === null) {
    return state;
  }

  return {
    ...state,
    marketId: event.market ?? state.marketId,
    lastTradePrice,
    timestamp:
      event.timestamp !== undefined ? normalizeTimestamp(event.timestamp) : state.timestamp,
  };
}

export function parseMarketChannelMessage(payload: unknown): MarketChannelEvent | null {
  if (!isRecord(payload) || typeof payload.event_type !== "string") {
    return null;
  }

  switch (payload.event_type) {
    case "book":
      if (
        typeof payload.asset_id !== "string" ||
        typeof payload.market !== "string" ||
        !isBookLevelArray(payload.bids) ||
        !isBookLevelArray(payload.asks) ||
        typeof payload.timestamp !== "string"
      ) {
        return null;
      }

      return {
        event_type: "book",
        asset_id: payload.asset_id,
        market: payload.market,
        bids: payload.bids,
        asks: payload.asks,
        timestamp: payload.timestamp,
        hash: typeof payload.hash === "string" ? payload.hash : null,
      };

    case "price_change":
      if (!Array.isArray(payload.price_changes)) {
        return null;
      }

      return {
        event_type: "price_change",
        price_changes: payload.price_changes.filter(isPriceChange),
      };

    case "tick_size_change":
      if (typeof payload.asset_id !== "string" || typeof payload.new_tick_size !== "string") {
        return null;
      }

      return {
        event_type: "tick_size_change",
        asset_id: payload.asset_id,
        new_tick_size: payload.new_tick_size,
        ...(typeof payload.market === "string" ? { market: payload.market } : {}),
        ...(typeof payload.old_tick_size === "string"
          ? { old_tick_size: payload.old_tick_size }
          : {}),
        ...(typeof payload.timestamp === "string" ? { timestamp: payload.timestamp } : {}),
      };

    case "last_trade_price":
      if (typeof payload.asset_id !== "string" || typeof payload.price !== "string") {
        return null;
      }

      return {
        event_type: "last_trade_price",
        asset_id: payload.asset_id,
        price: payload.price,
        ...(typeof payload.market === "string" ? { market: payload.market } : {}),
        ...(typeof payload.timestamp === "string" ? { timestamp: payload.timestamp } : {}),
      };

    default:
      return null;
  }
}

function cloneMarketChannelState(state: MarketChannelState): MarketChannelState {
  return {
    ...state,
    bids: new Map(state.bids),
    asks: new Map(state.asks),
  };
}

function createBookMap(
  levels: readonly BookLevel[] | readonly MarketChannelBookLevel[],
): Map<number, number> {
  const map = new Map<number, number>();

  for (const level of levels) {
    const price = typeof level.price === "number" ? level.price : safeNumber(level.price);
    const size = typeof level.size === "number" ? level.size : safeNumber(level.size);

    if (price === null || size === null || size <= 0) {
      continue;
    }

    map.set(price, size);
  }

  return map;
}

function toSortedLevels(levels: Map<number, number>, side: "buy" | "sell"): BookLevel[] {
  return [...levels.entries()]
    .map(([price, size]) => ({ price, size }))
    .sort((left, right) => (side === "buy" ? right.price - left.price : left.price - right.price));
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

function normalizeSide(value: string): "buy" | "sell" {
  return value.trim().toLowerCase() === "buy" ? "buy" : "sell";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBookLevelArray(value: unknown): value is MarketChannelBookLevel[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) && typeof entry.price === "string" && typeof entry.size === "string",
    )
  );
}

function isPriceChange(value: unknown): value is MarketChannelPriceChange {
  return (
    isRecord(value) &&
    typeof value.asset_id === "string" &&
    typeof value.side === "string" &&
    typeof value.price === "string" &&
    typeof value.size === "string"
  );
}
