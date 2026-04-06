export type ExecutionMode = "paper" | "live";

export type QuoteSide = "buy" | "sell";

export type OrderStatus = "open" | "filled" | "cancelled";

export type SnapshotSource = "live" | "replay";

export interface BookLevel {
  price: number;
  size: number;
}

export interface MarketSnapshot {
  marketId: string;
  tokenId: string;
  timestamp: number;
  bids: BookLevel[];
  asks: BookLevel[];
  tickSize: number;
  minOrderSize: number;
  negRisk: boolean;
  lastTradePrice: number | null;
  midpoint: number | null;
  bookHash: string | null;
  source: SnapshotSource;
}

export interface PositionState {
  inventory: number;
  averageEntryPrice: number | null;
  cash: number;
  updatedAt: number;
}

export interface RiskLimits {
  maxPosition: number;
  maxNotional: number;
  maxDrawdown: number;
  staleDataMs: number;
}

export interface QuoteIntent {
  intentId: string;
  marketId: string;
  tokenId: string;
  side: QuoteSide;
  price: number;
  size: number;
  createdAt: number;
  reason: string;
}

export interface OrderState {
  orderId: string;
  marketId: string;
  tokenId: string;
  side: QuoteSide;
  price: number;
  size: number;
  remainingSize: number;
  status: OrderStatus;
  executionMode: ExecutionMode;
  createdAt: number;
  updatedAt: number;
  note?: string;
}

export interface FillEvent {
  fillId: string;
  orderId: string;
  marketId: string;
  tokenId: string;
  side: QuoteSide;
  price: number;
  size: number;
  timestamp: number;
  cashDelta: number;
  inventoryAfter: number;
  reason: string;
}

export interface PnLState {
  markPrice: number | null;
  cash: number;
  inventory: number;
  averageEntryPrice: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  grossExposure: number;
}

export interface SignalSnapshot {
  marketId: string;
  timestamp: number;
  fairValueAdjBps: number;
  inventoryBias: number;
  confidence: number;
}

export interface KillSwitchStatus {
  triggered: boolean;
  reason: string | null;
}

export interface StrategyDecision {
  baseFairValue: number | null;
  adjustedFairValue: number | null;
  intents: QuoteIntent[];
  reasons: string[];
  signal: SignalSnapshot | null;
  killSwitchTriggered: boolean;
}

export interface ExecutionResult {
  orders: OrderState[];
  fills: FillEvent[];
  position: PositionState;
  pnl: PnLState;
  cancelledOrderIds: string[];
}
