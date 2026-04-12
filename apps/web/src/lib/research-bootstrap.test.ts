import { describe, expect, it } from "vitest";

import { loadResearchBootstrap } from "./research-bootstrap";

const baseEnv: NodeJS.ProcessEnv = {
  BOT_NAME: "test-bot",
  EXECUTION_MODE: "paper",
  NODE_ENV: "test",
  POLYMARKET_HOST: "https://clob.polymarket.com",
  POLYMARKET_CHAIN_ID: "137",
  POLYMARKET_MARKET_ID: "market-1",
  POLYMARKET_TOKEN_ID: "token-1",
};

describe("loadResearchBootstrap", () => {
  it("returns configured mode when market env is valid", () => {
    const result = loadResearchBootstrap(baseEnv);

    expect(result.mode).toBe("configured");
    if (result.mode === "configured") {
      expect(result.config.marketId).toBe("market-1");
      expect(result.config.tokenId).toBe("token-1");
    }
  });

  it("maps missing market env to setup-required issues", () => {
    const result = loadResearchBootstrap({
      ...baseEnv,
      POLYMARKET_MARKET_ID: "",
      POLYMARKET_TOKEN_ID: "",
    } as NodeJS.ProcessEnv);

    expect(result.mode).toBe("setup_required");
    if (result.mode === "setup_required") {
      expect(result.state.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            envKey: "POLYMARKET_MARKET_ID",
            kind: "missing",
          }),
          expect.objectContaining({
            envKey: "POLYMARKET_TOKEN_ID",
            kind: "missing",
          }),
        ]),
      );
    }
  });

  it("maps invalid chain id to an invalid issue", () => {
    const result = loadResearchBootstrap({
      ...baseEnv,
      POLYMARKET_CHAIN_ID: "NaN",
    } as NodeJS.ProcessEnv);

    expect(result.mode).toBe("setup_required");
    if (result.mode === "setup_required") {
      expect(result.state.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            envKey: "POLYMARKET_CHAIN_ID",
            kind: "invalid",
          }),
        ]),
      );
    }
  });

  it("includes the fixed setup checklist", () => {
    const result = loadResearchBootstrap({
      ...baseEnv,
      POLYMARKET_MARKET_ID: "",
    } as NodeJS.ProcessEnv);

    expect(result.mode).toBe("setup_required");
    if (result.mode === "setup_required") {
      expect(result.state.steps).toEqual(
        expect.arrayContaining([
          expect.stringContaining(".env.example"),
          expect.stringContaining("pnpm dev:web"),
        ]),
      );
    }
  });
});
