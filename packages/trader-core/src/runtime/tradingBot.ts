import type { JsonlArtifactStore } from "../artifacts/jsonlArtifactStore.js";
import type { AppConfig } from "../config.js";
import type { ExecutionAdapter } from "../execution/executionAdapter.js";
import type { PolymarketGateway, MarketDataSubscription } from "../gateways/polymarketGateway.js";
import type { Logger } from "../logger.js";
import type { FileSignalSource } from "../signals/fileSignalSource.js";
import { StrategyEngine } from "../strategy/strategyEngine.js";
import type { MarketSnapshot } from "../types.js";
import { KillSwitchMonitor } from "./killSwitch.js";

interface TradingBotOptions {
  config: AppConfig;
  artifactStore: JsonlArtifactStore;
  executor: ExecutionAdapter;
  gateway: PolymarketGateway;
  killSwitch: KillSwitchMonitor;
  logger: Logger;
  signalSource: FileSignalSource;
  strategy: StrategyEngine;
}

export class TradingBot {
  private subscription: MarketDataSubscription | null = null;
  private processing = false;
  private pendingSnapshot: MarketSnapshot | null = null;

  public constructor(private readonly options: TradingBotOptions) {}

  public async start(): Promise<void> {
    await this.options.artifactStore.append("sessions", {
      eventType: "start",
      botName: this.options.config.botName,
      marketId: this.options.config.marketId,
      tokenId: this.options.config.tokenId,
      executionMode: this.options.config.executionMode,
      replayInputPath: this.options.config.replayInputPath ?? null,
      startedAt: new Date().toISOString(),
    });

    this.subscription = await this.options.gateway.connectMarketData(
      async (snapshot) => {
        await this.enqueueSnapshot(snapshot);
      },
      (error) => {
        this.options.logger.error("Market data stream error", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  public async stop(): Promise<void> {
    await this.subscription?.stop();
    await this.options.executor.shutdown();
    await this.options.artifactStore.append("sessions", {
      eventType: "stop",
      stoppedAt: new Date().toISOString(),
    });
  }

  private async enqueueSnapshot(snapshot: MarketSnapshot): Promise<void> {
    if (this.processing) {
      this.pendingSnapshot = snapshot;
      return;
    }

    this.processing = true;
    let current: MarketSnapshot | null = snapshot;

    while (current) {
      try {
        await this.processSnapshot(current);
      } catch (error) {
        this.options.logger.error("Snapshot processing failed", {
          error: error instanceof Error ? error.message : String(error),
          marketId: current.marketId,
          tokenId: current.tokenId,
        });
      }

      current = this.pendingSnapshot;
      this.pendingSnapshot = null;
    }

    this.processing = false;
  }

  private async processSnapshot(snapshot: MarketSnapshot): Promise<void> {
    await this.options.artifactStore.append("market-snapshots", snapshot);

    const signal = await this.options.signalSource.read(this.options.config.marketId);
    const killSwitch = await this.options.killSwitch.readStatus();
    const position = await this.options.executor.getPositionState();
    const pnlBefore = await this.options.executor.getPnLState(
      snapshot.midpoint ?? snapshot.lastTradePrice,
    );
    const decision = this.options.strategy.generateDecision({
      snapshot,
      position,
      pnl: pnlBefore,
      signal,
      killSwitch,
    });

    await this.options.artifactStore.append("strategy-decisions", {
      snapshotTimestamp: snapshot.timestamp,
      marketId: snapshot.marketId,
      tokenId: snapshot.tokenId,
      decision,
    });

    const execution = await this.options.executor.applyQuoteIntents(decision.intents, snapshot);
    this.options.logger.info("Processed market snapshot", {
      marketId: snapshot.marketId,
      tokenId: snapshot.tokenId,
      source: snapshot.source,
      intents: decision.intents.length,
      fills: execution.fills.length,
      inventory: execution.position.inventory,
      totalPnl: execution.pnl.totalPnl,
      reasons: decision.reasons,
    });
  }
}
