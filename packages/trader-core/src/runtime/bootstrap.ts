import type { AppConfig } from "../config.js";
import { LiveExecutor } from "../execution/liveExecutor.js";
import { PaperExecutor } from "../execution/paperExecutor.js";
import { PolymarketClobGateway } from "../gateways/polymarketClobGateway.js";
import { ReplayPolymarketGateway } from "../gateways/replayPolymarketGateway.js";
import { JsonLogger, type Logger } from "../logger.js";
import { FileSignalSource } from "../signals/fileSignalSource.js";
import { StrategyEngine } from "../strategy/strategyEngine.js";
import { JsonlArtifactStore } from "../artifacts/jsonlArtifactStore.js";
import { KillSwitchMonitor } from "./killSwitch.js";
import { TradingBot } from "./tradingBot.js";

export function createTradingBot(
  config: AppConfig,
  logger: Logger = new JsonLogger(config.botName),
): TradingBot {
  const artifactStore = new JsonlArtifactStore(config.artifactsDir, logger.child("artifacts"));
  const gateway = config.replayInputPath
    ? new ReplayPolymarketGateway(
        config.replayInputPath,
        config.pollIntervalMs,
        config.replaySpeedMultiplier,
        logger.child("gateway"),
      )
    : PolymarketClobGateway.fromConfig(config, logger.child("gateway"));
  const executor =
    config.executionMode === "live"
      ? new LiveExecutor(gateway, logger.child("execution"), config.allowLiveExecution)
      : new PaperExecutor({
          initialCash: config.paperInitialCash,
          fillSlippageBps: config.paperFillSlippageBps,
          artifactStore,
          logger: logger.child("execution"),
        });
  const signalSource = new FileSignalSource(
    config.signalFilePath,
    config.signalMaxAgeMs,
    logger.child("signal"),
  );
  const killSwitch = new KillSwitchMonitor(config.killSwitchFile, logger.child("kill-switch"));
  const strategy = new StrategyEngine({
    baseSpreadBps: config.baseSpreadBps,
    quoteSize: config.quoteSize,
    minQuoteSize: config.minQuoteSize,
    inventorySkewBps: config.inventorySkewBps,
    riskLimits: config.riskLimits,
    logger: logger.child("strategy"),
  });

  return new TradingBot({
    config,
    artifactStore,
    executor,
    gateway,
    killSwitch,
    logger: logger.child("bot"),
    signalSource,
    strategy,
  });
}
