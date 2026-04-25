import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "@poly/trader-core/config";
import type { ResearchDashboardState } from "@poly/trader-core/research/evaluation";

vi.mock("@/lib/research-bootstrap", () => ({
  loadResearchBootstrap: vi.fn(),
}));

vi.mock("@/lib/research-hub", () => ({
  getResearchHub: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => config,
}));

const configuredBootstrap = {
  mode: "configured" as const,
  config: { marketId: "market-1", tokenId: "token-1" } as AppConfig,
};

const streamingState = {
  market: { marketId: "market-1" },
  recentEvaluations: [],
  resolvedSeries: [],
} as unknown as ResearchDashboardState;

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

    const { handleLiveStreamRequest } = await import("./live");
    const response = handleLiveStreamRequest();
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

    const { handleLiveStreamRequest } = await import("./live");
    const response = handleLiveStreamRequest();
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
