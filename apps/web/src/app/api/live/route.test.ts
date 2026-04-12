import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "@poly/trader-core/config";
import type { ResearchDashboardState } from "@poly/trader-core/research/evaluation";

vi.mock("@/lib/research-bootstrap", () => ({
  loadResearchBootstrap: vi.fn(),
}));

vi.mock("@/lib/research-hub", () => ({
  getResearchHub: vi.fn(),
}));

const configuredBootstrap: { mode: "configured"; config: AppConfig } = {
  mode: "configured",
  config: {
    botName: "test-bot",
    executionMode: "paper",
    allowLiveExecution: false,
    polymarketHost: "https://clob.polymarket.com",
    polymarketChainId: 137,
    marketId: "market-1",
    tokenId: "token-1",
    pollIntervalMs: 2_500,
    replayInputPath: undefined,
    replaySpeedMultiplier: 10,
    baseSpreadBps: 120,
    quoteSize: 10,
    minQuoteSize: 1,
    inventorySkewBps: 80,
    paperInitialCash: 1_000,
    paperFillSlippageBps: 2,
    signalFilePath: "/tmp/signal.json",
    signalMaxAgeMs: 30_000,
    artifactsDir: "/tmp/artifacts",
    killSwitchFile: "/tmp/kill-switch.json",
    riskLimits: {
      maxPosition: 50,
      maxNotional: 25,
      maxDrawdown: 5,
      staleDataMs: 15_000,
    },
    credentials: {
      privateKey: undefined,
      funderAddress: undefined,
      apiKey: undefined,
      apiSecret: undefined,
      apiPassphrase: undefined,
      signatureType: 1,
    },
  },
};

const streamingState: ResearchDashboardState = {
  connectionState: "live",
  market: {
    marketId: "market-1",
    tokenId: "token-1",
    source: "live",
    lastSnapshotAt: 1_710_000_000_000,
    currentMidpoint: 0.5,
    tickSize: 0.01,
    predictionCadenceMs: 30_000,
    truthHorizonMs: 300_000,
    accuracyBand: 0.02,
  },
  signalState: {
    status: "ready",
    confidence: 0.9,
    timestamp: 1_710_000_000_000,
    fairValueAdjBps: 25,
    message: null,
  },
  pendingCount: 1,
  rollingAccuracy: null,
  latestPrediction: null,
  latestResolved: null,
  resolvedSeries: [],
  recentEvaluations: [],
};

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("/api/live route", () => {
  it("returns a setup-required SSE payload instead of a 500 when config is invalid", async () => {
    const { loadResearchBootstrap } = await import("@/lib/research-bootstrap");
    vi.mocked(loadResearchBootstrap).mockReturnValue({
      mode: "setup_required",
      state: {
        status: "setup_required",
        issues: [
          {
            envKey: "POLYMARKET_MARKET_ID",
            kind: "missing",
            message: "Add `POLYMARKET_MARKET_ID`.",
          },
        ],
        steps: ["Copy `.env.example` to `.env`."],
      },
    });

    const { GET } = await import("./route");
    const response = await GET();
    const text = await readUntilSnapshot(response);

    expect(response.status).toBe(200);
    expect(text).toContain('"mode":"setup_required"');
    expect(text).toContain("POLYMARKET_MARKET_ID");
  });

  it("continues returning a streaming SSE payload when config is valid", async () => {
    const { loadResearchBootstrap } = await import("@/lib/research-bootstrap");
    const { getResearchHub } = await import("@/lib/research-hub");

    vi.mocked(loadResearchBootstrap).mockReturnValue(configuredBootstrap);
    vi.mocked(getResearchHub).mockReturnValue(
      {
        getState: () => streamingState,
        subscribe: (listener: (state: ResearchDashboardState) => void) => {
          listener(streamingState);
          return () => undefined;
        },
        ensureStarted: async () => undefined,
      } as unknown as ReturnType<typeof getResearchHub>,
    );

    const { GET } = await import("./route");
    const response = await GET();
    const text = await readUntilSnapshot(response);

    expect(response.status).toBe(200);
    expect(text).toContain('"mode":"streaming"');
    expect(text).toContain('"marketId":"market-1"');
  });
});

async function readUntilSnapshot(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response stream missing");
  }

  const decoder = new TextDecoder();
  let text = "";

  for (let index = 0; index < 4; index += 1) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    text += decoder.decode(value, { stream: true });
    if (text.includes("event: snapshot")) {
      break;
    }
  }

  await reader.cancel();
  return text;
}
