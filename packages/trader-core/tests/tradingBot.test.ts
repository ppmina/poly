import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { JsonlArtifactStore } from "../src/artifacts/jsonlArtifactStore.js";
import { PaperExecutor } from "../src/execution/paperExecutor.js";
import type {
  MarketDataSubscription,
  PolymarketGateway,
} from "../src/gateways/polymarketGateway.js";
import { KillSwitchMonitor } from "../src/runtime/killSwitch.js";
import { TradingBot } from "../src/runtime/tradingBot.js";
import { FileSignalSource } from "../src/signals/fileSignalSource.js";
import { StrategyEngine } from "../src/strategy/strategyEngine.js";
import type { MarketSnapshot, OrderState, QuoteIntent } from "../src/types.js";
import { createNoopLogger } from "./helpers.js";

class FakeGateway implements PolymarketGateway {
  private listener: ((snapshot: MarketSnapshot) => Promise<void> | void) | null = null;

  public async connectMarketData(
    listener: (snapshot: MarketSnapshot) => Promise<void> | void,
  ): Promise<MarketDataSubscription> {
    this.listener = listener;
    return {
      stop: () => {
        this.listener = null;
      },
    };
  }

  public async getBookSnapshot(): Promise<MarketSnapshot> {
    throw new Error("Not used in this test");
  }

  public async listOpenOrders(): Promise<OrderState[]> {
    return [];
  }

  public async submitQuoteIntents(_intents: QuoteIntent[]): Promise<OrderState[]> {
    return [];
  }

  public async cancelOpenOrders(): Promise<void> {
    return;
  }

  public async emit(snapshot: MarketSnapshot): Promise<void> {
    await this.listener?.(snapshot);
  }
}

function buildSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    marketId: "market-1",
    tokenId: "token-1",
    timestamp: Date.now(),
    bids: [{ price: 0.45, size: 50 }],
    asks: [{ price: 0.55, size: 50 }],
    tickSize: 0.01,
    minOrderSize: 1,
    negRisk: false,
    lastTradePrice: 0.5,
    midpoint: 0.5,
    bookHash: "hash-1",
    source: "live",
    ...overrides,
  };
}

function buildConfig(artifactsDir: string, signalPath: string, killSwitchPath: string): AppConfig {
  return {
    botName: "test-bot",
    executionMode: "paper",
    allowLiveExecution: false,
    polymarketHost: "https://clob.polymarket.com",
    polymarketChainId: 137,
    marketId: "market-1",
    tokenId: "token-1",
    pollIntervalMs: 10,
    replayInputPath: undefined,
    replaySpeedMultiplier: 10,
    baseSpreadBps: 200,
    quoteSize: 10,
    minQuoteSize: 1,
    inventorySkewBps: 100,
    paperInitialCash: 1_000,
    paperFillSlippageBps: 0,
    signalFilePath: signalPath,
    signalMaxAgeMs: 5_000,
    artifactsDir,
    killSwitchFile: killSwitchPath,
    riskLimits: {
      maxPosition: 20,
      maxNotional: 20,
      maxDrawdown: 5,
      staleDataMs: 10_000,
    },
    credentials: {
      privateKey: undefined,
      funderAddress: undefined,
      apiKey: undefined,
      apiSecret: undefined,
      apiPassphrase: undefined,
      signatureType: 1,
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("TradingBot", () => {
  it("quotes, fills in paper mode, and writes session artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "poly-bot-"));
    const config = buildConfig(dir, join(dir, "signal.json"), join(dir, "kill.json"));
    const gateway = new FakeGateway();
    const artifactStore = new JsonlArtifactStore(dir, createNoopLogger());
    const executor = new PaperExecutor({
      initialCash: config.paperInitialCash,
      fillSlippageBps: config.paperFillSlippageBps,
      artifactStore,
      logger: createNoopLogger(),
    });
    const bot = new TradingBot({
      config,
      artifactStore,
      executor,
      gateway,
      killSwitch: new KillSwitchMonitor(config.killSwitchFile, createNoopLogger()),
      logger: createNoopLogger(),
      signalSource: new FileSignalSource(
        config.signalFilePath,
        config.signalMaxAgeMs,
        createNoopLogger(),
      ),
      strategy: new StrategyEngine({
        baseSpreadBps: config.baseSpreadBps,
        quoteSize: config.quoteSize,
        minQuoteSize: config.minQuoteSize,
        inventorySkewBps: config.inventorySkewBps,
        riskLimits: config.riskLimits,
        logger: createNoopLogger(),
      }),
    });

    await bot.start();
    await gateway.emit(buildSnapshot());
    await flushAsyncWork();

    const ordersAfterQuote = await executor.getOpenOrders();
    expect(ordersAfterQuote).toHaveLength(2);

    await gateway.emit(
      buildSnapshot({
        bids: [{ price: 0.52, size: 50 }],
        asks: [{ price: 0.48, size: 50 }],
      }),
    );
    await flushAsyncWork();

    const pnl = await executor.getPnLState(0.5);
    expect(pnl.totalPnl).toBeGreaterThan(0);

    await bot.stop();
    await expect(access(join(dir, "market-snapshots.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(dir, "fills.jsonl"))).resolves.toBeUndefined();
    await expect(access(join(dir, "sessions.jsonl"))).resolves.toBeUndefined();
  });
});
