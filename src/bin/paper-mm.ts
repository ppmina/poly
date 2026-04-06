import { loadAppConfig } from "../config.js";
import { JsonLogger } from "../logger.js";
import { createTradingBot } from "../runtime/bootstrap.js";

const config = loadAppConfig();
const logger = new JsonLogger(config.botName);
const bot = createTradingBot(config, logger);

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("Shutting down bot", { signal });
  await bot.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await bot.start();
logger.info("Bot started", {
  executionMode: config.executionMode,
  marketId: config.marketId,
  tokenId: config.tokenId,
  replayInputPath: config.replayInputPath ?? null,
});

await new Promise(() => {
  return;
});
