import { loadAppConfig } from "../config.js";
import { JsonLogger } from "../logger.js";
import { createTradingBot } from "../runtime/bootstrap.js";

const config = loadAppConfig();
if (!config.replayInputPath) {
  throw new Error("REPLAY_INPUT_PATH is required for replay mode");
}

const logger = new JsonLogger(`${config.botName}.replay`);
const bot = createTradingBot(
  {
    ...config,
    executionMode: "paper",
  },
  logger,
);

let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("Shutting down replay bot", { signal });
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
logger.info("Replay bot started", {
  replayInputPath: config.replayInputPath,
  marketId: config.marketId,
  tokenId: config.tokenId,
});

await new Promise(() => {
  return;
});
