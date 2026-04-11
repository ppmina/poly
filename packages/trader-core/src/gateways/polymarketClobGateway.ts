import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import type {
  ApiKeyCreds,
  ClobSigner,
  CreateOrderOptions,
  TickSize,
} from "@polymarket/clob-client";
import { Wallet } from "ethers";

import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { MarketSnapshot, OrderState, QuoteIntent } from "../types.js";
import {
  applyMarketChannelBookEvent,
  applyMarketChannelLastTradePriceEvent,
  applyMarketChannelPriceChangeEvent,
  applyMarketChannelTickSizeChangeEvent,
  createMarketChannelState,
  parseMarketChannelMessage,
  toMarketSnapshot,
  type MarketChannelBookEvent,
  type MarketChannelLastTradePriceEvent,
  type MarketChannelPriceChangeEvent,
  type MarketChannelState,
  type MarketChannelTickSizeChangeEvent,
} from "./polymarketMarketChannel.js";
import {
  normalizeOpenOrder,
  normalizeOrderBook,
  type MarketDataSubscription,
  type PolymarketGateway,
} from "./polymarketGateway.js";

const MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const WS_OPEN = 1;
const HEARTBEAT_INTERVAL_MS = 10_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface MarketSocketEvent {
  data: unknown;
}

interface MarketSocketCloseEvent {
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

interface MarketWebSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: MarketSocketEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: MarketSocketCloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type MarketWebSocketFactory = (url: string) => MarketWebSocket;

function defaultMarketWebSocketFactory(url: string): MarketWebSocket {
  return new WebSocket(url) as unknown as MarketWebSocket;
}

export class PolymarketClobGateway implements PolymarketGateway {
  private lastSnapshot: MarketSnapshot | null = null;
  private marketState: MarketChannelState | null = null;
  private bootstrapPromise: Promise<MarketSnapshot> | null = null;

  public constructor(
    private readonly client: ClobClient,
    private readonly marketId: string,
    private readonly tokenId: string,
    private readonly logger: Logger,
    private readonly hasTradingAccess: boolean,
    private readonly webSocketFactory: MarketWebSocketFactory = defaultMarketWebSocketFactory,
  ) {}

  public static fromConfig(config: AppConfig, logger: Logger): PolymarketClobGateway {
    const client = buildClobClient(config);
    const hasTradingAccess =
      Boolean(config.credentials.privateKey) &&
      Boolean(config.credentials.funderAddress) &&
      Boolean(config.credentials.apiKey) &&
      Boolean(config.credentials.apiSecret) &&
      Boolean(config.credentials.apiPassphrase);

    return new PolymarketClobGateway(
      client,
      config.marketId,
      config.tokenId,
      logger,
      hasTradingAccess,
    );
  }

  public async connectMarketData(
    listener: (snapshot: MarketSnapshot) => Promise<void> | void,
    onError?: (error: unknown) => void,
  ): Promise<MarketDataSubscription> {
    let stopped = false;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let reconnectTimer: NodeJS.Timeout | undefined;
    let socket: MarketWebSocket | null = null;
    let reconnectAttempts = 0;
    let processingQueue = Promise.resolve();

    const clearHeartbeat = (): void => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const clearReconnect = (): void => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const reportError = (error: unknown, message: string): void => {
      this.logger.warn(message, {
        error: error instanceof Error ? error.message : String(error),
        marketId: this.marketId,
        tokenId: this.tokenId,
      });
      onError?.(error);
    };

    const closeSocket = (): void => {
      if (!socket) {
        return;
      }

      const activeSocket = socket;
      socket = null;
      activeSocket.onopen = null;
      activeSocket.onmessage = null;
      activeSocket.onerror = null;
      activeSocket.onclose = null;
      try {
        activeSocket.close();
      } catch {
        return;
      }
    };

    const scheduleReconnect = (reason: string): void => {
      if (stopped || reconnectTimer) {
        return;
      }

      clearHeartbeat();
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempts,
        MAX_RECONNECT_DELAY_MS,
      );
      reconnectAttempts += 1;

      this.logger.info("Scheduling market data reconnect", {
        delayMs: delay,
        reason,
        marketId: this.marketId,
        tokenId: this.tokenId,
      });

      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, delay);
    };

    const startHeartbeat = (activeSocket: MarketWebSocket): void => {
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (stopped || socket !== activeSocket || activeSocket.readyState !== WS_OPEN) {
          return;
        }

        try {
          activeSocket.send("PING");
        } catch (error) {
          reportError(error, "Failed to send market data heartbeat");
          try {
            activeSocket.close();
          } catch {
            scheduleReconnect("heartbeat_send_failed");
          }
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    const processRawMessage = async (rawData: unknown): Promise<void> => {
      const messageText = await readSocketMessage(rawData);
      if (messageText === null) {
        return;
      }

      const normalizedHeartbeat = messageText.trim().toUpperCase();
      if (normalizedHeartbeat === "PONG" || normalizedHeartbeat === "PING") {
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(messageText);
      } catch (error) {
        this.logger.warn("Ignoring non-JSON market data message", {
          error: error instanceof Error ? error.message : String(error),
          preview: messageText.slice(0, 120),
        });
        return;
      }

      const records = Array.isArray(payload) ? payload : [payload];
      for (const record of records) {
        await this.handleMarketChannelPayload(record, listener);
      }
    };

    const connect = async (): Promise<void> => {
      if (stopped) {
        return;
      }

      clearReconnect();
      const activeSocket = this.webSocketFactory(MARKET_WS_URL);
      socket = activeSocket;

      activeSocket.onopen = () => {
        if (stopped || socket !== activeSocket) {
          return;
        }

        reconnectAttempts = 0;
        try {
          activeSocket.send(
            JSON.stringify({
              assets_ids: [this.tokenId],
              type: "market",
            }),
          );
        } catch (error) {
          reportError(error, "Failed to subscribe to market data");
          scheduleReconnect("subscription_send_failed");
          return;
        }

        startHeartbeat(activeSocket);
        this.logger.info("Connected to Polymarket market websocket", {
          marketId: this.marketId,
          tokenId: this.tokenId,
          url: MARKET_WS_URL,
        });
      };

      activeSocket.onmessage = (event) => {
        processingQueue = processingQueue
          .then(async () => {
            await processRawMessage(event.data);
          })
          .catch((error) => {
            reportError(error, "Market websocket message handling failed");
          });
      };

      activeSocket.onerror = (event) => {
        reportError(event, "Polymarket market websocket error");
        if (socket === activeSocket) {
          try {
            activeSocket.close();
          } catch {
            scheduleReconnect("socket_error");
          }
        }
      };

      activeSocket.onclose = (event) => {
        if (socket === activeSocket) {
          socket = null;
        }

        clearHeartbeat();
        if (stopped) {
          return;
        }

        this.logger.warn("Polymarket market websocket closed", {
          code: event.code ?? null,
          reason: event.reason ?? null,
          wasClean: event.wasClean ?? null,
          marketId: this.marketId,
          tokenId: this.tokenId,
        });
        scheduleReconnect("socket_close");
      };
    };

    void connect();

    return {
      stop: async () => {
        stopped = true;
        clearHeartbeat();
        clearReconnect();
        closeSocket();
        await processingQueue.catch(() => undefined);
      },
    };
  }

  public async getBookSnapshot(): Promise<MarketSnapshot> {
    if (this.lastSnapshot) {
      return this.lastSnapshot;
    }

    return this.bootstrapSnapshot();
  }

  public async listOpenOrders(): Promise<OrderState[]> {
    if (!this.hasTradingAccess) {
      return [];
    }

    const openOrders = await this.client.getOpenOrders({
      market: this.marketId,
      asset_id: this.tokenId,
    });
    return openOrders.map((order) => normalizeOpenOrder(order, "live"));
  }

  public async submitQuoteIntents(intents: QuoteIntent[]): Promise<OrderState[]> {
    if (!this.hasTradingAccess) {
      throw new Error("Trading credentials are not configured for live order submission");
    }

    const orderOptions = await this.resolveCreateOrderOptions();

    for (const intent of intents) {
      await this.client.createAndPostOrder(
        {
          tokenID: intent.tokenId,
          price: intent.price,
          side: intent.side === "buy" ? Side.BUY : Side.SELL,
          size: intent.size,
        },
        orderOptions,
        OrderType.GTC,
        false,
        true,
      );
    }

    return this.listOpenOrders();
  }

  public async cancelOpenOrders(orderIds?: string[]): Promise<void> {
    if (!this.hasTradingAccess) {
      return;
    }

    if (orderIds && orderIds.length > 0) {
      await this.client.cancelOrders(orderIds);
      return;
    }

    await this.client.cancelAll();
  }

  private async resolveCreateOrderOptions(): Promise<Partial<CreateOrderOptions>> {
    if (this.lastSnapshot) {
      return {
        tickSize: formatTickSize(this.lastSnapshot.tickSize),
        negRisk: this.lastSnapshot.negRisk,
      };
    }

    const [tickSize, negRisk] = await Promise.all([
      this.client.getTickSize(this.tokenId),
      this.client.getNegRisk(this.tokenId),
    ]);

    return {
      tickSize,
      negRisk,
    };
  }

  private async handleMarketChannelPayload(
    payload: unknown,
    listener: (snapshot: MarketSnapshot) => Promise<void> | void,
  ): Promise<void> {
    const event = parseMarketChannelMessage(payload);
    if (!event) {
      this.logger.debug("Ignoring unsupported market websocket message", {
        payload:
          isRecord(payload) && typeof payload.event_type === "string" ? payload.event_type : null,
      });
      return;
    }

    switch (event.event_type) {
      case "book":
        if (event.asset_id !== this.tokenId) {
          return;
        }
        await this.emitSnapshot(this.handleBookEvent(event), listener);
        return;

      case "price_change":
        if (!event.price_changes.some((change) => change.asset_id === this.tokenId)) {
          return;
        }
        await this.emitSnapshot(this.handlePriceChangeEvent(event), listener);
        return;

      case "tick_size_change":
        if (event.asset_id !== this.tokenId) {
          return;
        }
        await this.emitSnapshot(this.handleTickSizeChangeEvent(event), listener);
        return;

      case "last_trade_price":
        if (event.asset_id !== this.tokenId) {
          return;
        }
        await this.emitSnapshot(this.handleLastTradePriceEvent(event), listener);
        return;
    }
  }

  private async emitSnapshot(
    nextStatePromise: Promise<MarketChannelState>,
    listener: (snapshot: MarketSnapshot) => Promise<void> | void,
  ): Promise<void> {
    const nextState = await nextStatePromise;
    const snapshot = toMarketSnapshot(nextState, "live");
    this.marketState = nextState;
    this.lastSnapshot = snapshot;
    await listener(snapshot);
  }

  private async handleBookEvent(event: MarketChannelBookEvent): Promise<MarketChannelState> {
    const state = await this.ensureMarketState();
    return applyMarketChannelBookEvent(state, event);
  }

  private async handlePriceChangeEvent(
    event: MarketChannelPriceChangeEvent,
  ): Promise<MarketChannelState> {
    const state = await this.ensureMarketState();
    return applyMarketChannelPriceChangeEvent(state, event);
  }

  private async handleTickSizeChangeEvent(
    event: MarketChannelTickSizeChangeEvent,
  ): Promise<MarketChannelState> {
    const state = await this.ensureMarketState();
    return applyMarketChannelTickSizeChangeEvent(state, event);
  }

  private async handleLastTradePriceEvent(
    event: MarketChannelLastTradePriceEvent,
  ): Promise<MarketChannelState> {
    const state = await this.ensureMarketState();
    return applyMarketChannelLastTradePriceEvent(state, event);
  }

  private async ensureMarketState(): Promise<MarketChannelState> {
    if (this.marketState) {
      return this.marketState;
    }

    const snapshot = await this.bootstrapSnapshot();
    if (this.marketState) {
      return this.marketState;
    }

    this.marketState = createMarketChannelState(snapshot);
    return this.marketState;
  }

  private async bootstrapSnapshot(): Promise<MarketSnapshot> {
    if (this.lastSnapshot) {
      return this.lastSnapshot;
    }

    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.client
        .getOrderBook(this.tokenId)
        .then((orderBook) => normalizeOrderBook(orderBook, "live"))
        .then((snapshot) => {
          this.lastSnapshot = snapshot;
          this.marketState ??= createMarketChannelState(snapshot);
          return snapshot;
        })
        .finally(() => {
          this.bootstrapPromise = null;
        });
    }

    return this.bootstrapPromise;
  }
}

export function buildClobClient(config: AppConfig): ClobClient {
  const creds = buildApiKeyCreds(config);
  const signer = config.credentials.privateKey
    ? buildEthersSigner(config.credentials.privateKey)
    : undefined;

  return new ClobClient(
    config.polymarketHost,
    config.polymarketChainId,
    signer,
    creds,
    config.credentials.signatureType,
    config.credentials.funderAddress,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true,
  );
}

function buildEthersSigner(privateKey: string): ClobSigner {
  const wallet = new Wallet(privateKey);

  return {
    _signTypedData: async (domain, types, value) => {
      return wallet.signTypedData(domain, types, value);
    },
    getAddress: async () => wallet.address,
  };
}

function buildApiKeyCreds(config: AppConfig): ApiKeyCreds | undefined {
  if (
    !config.credentials.apiKey ||
    !config.credentials.apiSecret ||
    !config.credentials.apiPassphrase
  ) {
    return undefined;
  }

  return {
    key: config.credentials.apiKey,
    secret: config.credentials.apiSecret,
    passphrase: config.credentials.apiPassphrase,
  };
}

function formatTickSize(value: number): TickSize {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") as TickSize;
}

async function readSocketMessage(data: unknown): Promise<string | null> {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  if (data instanceof Blob) {
    return data.text();
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
