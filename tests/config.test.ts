import { describe, expect, it } from "vitest";

import { loadAppConfig } from "../src/config.js";

const baseEnv = {
  BOT_NAME: "test-bot",
  EXECUTION_MODE: "paper",
  POLYMARKET_HOST: "https://clob.polymarket.com",
  POLYMARKET_CHAIN_ID: "137",
  POLYMARKET_MARKET_ID: "market-1",
  POLYMARKET_TOKEN_ID: "token-1",
};

describe("loadAppConfig", () => {
  it("loads defaults for the paper bot", () => {
    const config = loadAppConfig(baseEnv);

    expect(config.executionMode).toBe("paper");
    expect(config.quoteSize).toBe(10);
    expect(config.riskLimits.maxPosition).toBe(50);
    expect(config.signalFilePath.endsWith("artifacts/signals/current.json")).toBe(true);
  });

  it("blocks live execution unless explicitly enabled", () => {
    expect(() =>
      loadAppConfig({
        ...baseEnv,
        EXECUTION_MODE: "live",
      }),
    ).toThrow("ALLOW_LIVE_EXECUTION=true");
  });
});
