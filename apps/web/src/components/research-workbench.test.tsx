import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ResearchDashboardState } from "@poly/trader-core/research/evaluation";

import { ResearchWorkbenchView } from "./research-workbench";

vi.mock("liveline", () => ({
  Liveline: () => createElement("div", { "data-testid": "liveline" }, "Liveline"),
}));

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
  rollingAccuracy: 0.72,
  latestPrediction: {
    predictedAt: 1_710_000_000_000,
    marketId: "market-1",
    midpointAtPrediction: 0.5,
    baseFairValue: 0.503,
    predictionValue: 0.505,
    confidence: 0.9,
  },
  latestResolved: {
    predictedAt: 1_709_999_700_000,
    truthAt: 1_710_000_000_000,
    predictionValue: 0.505,
    truthValue: 0.497,
    diff: 0.008,
    accurate: true,
    confidence: 0.9,
  },
  resolvedSeries: [],
  recentEvaluations: [],
};

describe("ResearchWorkbenchView", () => {
  it("renders inline setup guidance in setup-required mode", () => {
    const markup = renderToStaticMarkup(
      createElement(ResearchWorkbenchView, {
        streamState: {
          mode: "setup_required",
          state: {
            status: "setup_required",
            issues: [
              {
                envKey: "POLYMARKET_CHAIN_ID",
                kind: "invalid",
                message: "Set `POLYMARKET_CHAIN_ID` to `137` or `80002`.",
              },
            ],
            steps: ["Copy `.env.example` to `.env`.", "Restart `pnpm dev:web`."],
          },
        },
      }),
    );

    expect(markup).toContain("Setup required");
    expect(markup).toContain("POLYMARKET_CHAIN_ID");
    expect(markup).toContain("Restart `pnpm dev:web`.");
    expect(markup).not.toContain("Feed interrupted");
  });

  it("renders live research content in streaming mode", () => {
    const markup = renderToStaticMarkup(
      createElement(ResearchWorkbenchView, {
        streamState: {
          mode: "streaming",
          state: streamingState,
        },
      }),
    );

    expect(markup).toContain("Live feed");
    expect(markup).toContain("Prediction versus truth over the last hour");
    expect(markup).toContain("Latest sampled model value");
  });
});
