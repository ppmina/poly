import type { ClobClient } from "@polymarket/clob-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PolymarketClobGateway } from "../src/gateways/polymarketClobGateway.js";
import { createNoopLogger } from "./helpers.js";

class MockMarketWebSocket {
  public static instances: MockMarketWebSocket[] = [];

  public readonly sent: string[] = [];
  public readyState = 0;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: unknown }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code?: number; reason?: string; wasClean?: boolean }) => void) | null =
    null;

  public constructor(public readonly url: string) {
    MockMarketWebSocket.instances.push(this);
  }

  public open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  public emitJson(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  public send(data: string): void {
    this.sent.push(data);
  }

  public triggerError(error: unknown = new Error("socket error")): void {
    this.onerror?.(error);
  }

  public close(code = 1000, reason = "closed"): void {
    this.readyState = 3;
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }
}

function createClient(): ClobClient {
  return {
    getOrderBook: vi.fn().mockResolvedValue({
      market: "market-1",
      asset_id: "token-1",
      bids: [
        { price: "0.49", size: "7" },
        { price: "0.48", size: "5" },
      ],
      asks: [
        { price: "0.51", size: "8" },
        { price: "0.52", size: "9" },
      ],
      timestamp: "1700000000000",
      tick_size: "0.01",
      min_order_size: "1",
      neg_risk: false,
      last_trade_price: "0.5",
      hash: "bootstrap-hash",
    }),
    getOpenOrders: vi.fn(),
    createAndPostOrder: vi.fn(),
    cancelOrders: vi.fn(),
    cancelAll: vi.fn(),
    getTickSize: vi.fn(),
    getNegRisk: vi.fn(),
  } as unknown as ClobClient;
}

describe("PolymarketClobGateway websocket market data", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockMarketWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes immediately, heartbeats, and emits snapshots from book events", async () => {
    const listener = vi.fn();
    const gateway = new PolymarketClobGateway(
      createClient(),
      "market-1",
      "token-1",
      createNoopLogger(),
      false,
      (url) => new MockMarketWebSocket(url),
    );

    const subscription = await gateway.connectMarketData(listener);
    const socket = MockMarketWebSocket.instances[0];

    expect(socket?.url).toBe("wss://ws-subscriptions-clob.polymarket.com/ws/market");
    socket?.open();

    expect(JSON.parse(socket?.sent[0] ?? "{}")).toEqual({
      assets_ids: ["token-1"],
      type: "market",
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket?.sent).toContain("PING");

    socket?.emitJson({
      event_type: "book",
      asset_id: "token-1",
      market: "market-1",
      bids: [{ price: "0.55", size: "11" }],
      asks: [{ price: "0.56", size: "13" }],
      timestamp: "1700000001000",
      hash: "hash-2",
    });

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(1);
    });

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        bids: [{ price: 0.55, size: 11 }],
        asks: [{ price: 0.56, size: 13 }],
        tickSize: 0.01,
        minOrderSize: 1,
        negRisk: false,
        bookHash: "hash-2",
      }),
    );

    await subscription.stop();
  });

  it("reconnects and resubscribes after socket close", async () => {
    const listener = vi.fn();
    const gateway = new PolymarketClobGateway(
      createClient(),
      "market-1",
      "token-1",
      createNoopLogger(),
      false,
      (url) => new MockMarketWebSocket(url),
    );

    const subscription = await gateway.connectMarketData(listener);
    const firstSocket = MockMarketWebSocket.instances[0];
    firstSocket?.open();
    firstSocket?.close(1006, "network");

    await vi.advanceTimersByTimeAsync(1_000);

    const secondSocket = MockMarketWebSocket.instances[1];
    expect(secondSocket).toBeDefined();
    secondSocket?.open();

    expect(JSON.parse(secondSocket?.sent[0] ?? "{}")).toEqual({
      assets_ids: ["token-1"],
      type: "market",
    });

    await subscription.stop();
  });

  it("ignores market messages for other assets", async () => {
    const listener = vi.fn();
    const gateway = new PolymarketClobGateway(
      createClient(),
      "market-1",
      "token-1",
      createNoopLogger(),
      false,
      (url) => new MockMarketWebSocket(url),
    );

    const subscription = await gateway.connectMarketData(listener);
    const socket = MockMarketWebSocket.instances[0];
    socket?.open();
    socket?.emitJson({
      event_type: "price_change",
      price_changes: [
        {
          asset_id: "other-token",
          market: "market-1",
          side: "BUY",
          price: "0.4",
          size: "1",
          timestamp: "1700000002000",
        },
      ],
    });

    await vi.waitFor(() => {
      expect(listener).not.toHaveBeenCalled();
    });
    await subscription.stop();
  });
});
