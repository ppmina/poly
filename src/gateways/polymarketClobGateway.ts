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
  normalizeOpenOrder,
  normalizeOrderBook,
  type MarketDataSubscription,
  type PolymarketGateway,
} from "./polymarketGateway.js";

export class PolymarketClobGateway implements PolymarketGateway {
  private lastSnapshot: MarketSnapshot | null = null;

  public constructor(
    private readonly client: ClobClient,
    private readonly marketId: string,
    private readonly tokenId: string,
    private readonly pollIntervalMs: number,
    private readonly logger: Logger,
    private readonly hasTradingAccess: boolean,
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
      config.pollIntervalMs,
      logger,
      hasTradingAccess,
    );
  }

  public async connectMarketData(
    listener: (snapshot: MarketSnapshot) => Promise<void> | void,
    onError?: (error: unknown) => void,
  ): Promise<MarketDataSubscription> {
    let stopped = false;
    let timeout: NodeJS.Timeout | undefined;

    const pump = async (): Promise<void> => {
      if (stopped) {
        return;
      }

      try {
        const snapshot = await this.getBookSnapshot();
        await listener(snapshot);
      } catch (error) {
        this.logger.warn("Market data poll failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        onError?.(error);
      } finally {
        if (!stopped) {
          timeout = setTimeout(() => {
            void pump();
          }, this.pollIntervalMs);
        }
      }
    };

    void pump();

    return {
      stop: () => {
        stopped = true;
        if (timeout) {
          clearTimeout(timeout);
        }
      },
    };
  }

  public async getBookSnapshot(): Promise<MarketSnapshot> {
    const orderBook = await this.client.getOrderBook(this.tokenId);
    const snapshot = normalizeOrderBook(orderBook, "live");
    this.lastSnapshot = snapshot;
    return snapshot;
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
