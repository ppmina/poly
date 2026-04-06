import type {
  ExecutionResult,
  MarketSnapshot,
  OrderState,
  PnLState,
  PositionState,
  QuoteIntent,
} from "../types.js";

export interface ExecutionAdapter {
  getOpenOrders(): Promise<OrderState[]>;
  getPositionState(): Promise<PositionState>;
  getPnLState(markPrice?: number | null): Promise<PnLState>;
  applyQuoteIntents(intents: QuoteIntent[], snapshot: MarketSnapshot): Promise<ExecutionResult>;
  shutdown(): Promise<void>;
}
