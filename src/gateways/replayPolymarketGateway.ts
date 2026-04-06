import { readFile } from "node:fs/promises";

import type { Logger } from "../logger.js";
import type { MarketSnapshot, OrderState, QuoteIntent } from "../types.js";
import type { MarketDataSubscription, PolymarketGateway } from "./polymarketGateway.js";

export class ReplayPolymarketGateway implements PolymarketGateway {
  private frames: MarketSnapshot[] | null = null;
  private lastSnapshot: MarketSnapshot | null = null;

  public constructor(
    private readonly inputPath: string,
    private readonly fallbackIntervalMs: number,
    private readonly speedMultiplier: number,
    private readonly logger: Logger,
  ) {}

  public async connectMarketData(
    listener: (snapshot: MarketSnapshot) => Promise<void> | void,
    onError?: (error: unknown) => void,
  ): Promise<MarketDataSubscription> {
    const frames = await this.loadFrames();
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const emitFrame = async (index: number): Promise<void> => {
      if (stopped || index >= frames.length) {
        return;
      }

      try {
        const snapshot = frames[index]!;
        this.lastSnapshot = snapshot;
        await listener(snapshot);
      } catch (error) {
        this.logger.warn("Replay emission failed", {
          error: error instanceof Error ? error.message : String(error),
          inputPath: this.inputPath,
        });
        onError?.(error);
      }

      const nextIndex = index + 1;
      if (stopped || nextIndex >= frames.length) {
        return;
      }

      const delay = computeReplayDelay(
        frames[index]!.timestamp,
        frames[nextIndex]!.timestamp,
        this.fallbackIntervalMs,
        this.speedMultiplier,
      );

      timer = setTimeout(() => {
        void emitFrame(nextIndex);
      }, delay);
    };

    void emitFrame(0);

    return {
      stop: () => {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
        }
      },
    };
  }

  public async getBookSnapshot(): Promise<MarketSnapshot> {
    if (this.lastSnapshot) {
      return this.lastSnapshot;
    }

    const frames = await this.loadFrames();
    const snapshot = frames[0];
    if (!snapshot) {
      throw new Error(`Replay file ${this.inputPath} does not contain any market snapshots`);
    }

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  public async listOpenOrders(): Promise<OrderState[]> {
    return [];
  }

  public async submitQuoteIntents(_intents: QuoteIntent[]): Promise<OrderState[]> {
    throw new Error("Replay gateway does not support live order submission");
  }

  public async cancelOpenOrders(): Promise<void> {
    return;
  }

  private async loadFrames(): Promise<MarketSnapshot[]> {
    if (this.frames) {
      return this.frames;
    }

    const raw = await readFile(this.inputPath, "utf8");
    const frames = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .map((record) => {
        const candidate = isRecord(record.snapshot) ? record.snapshot : record;
        if (!isMarketSnapshot(candidate)) {
          throw new Error(`Replay file ${this.inputPath} contains a non-snapshot record`);
        }

        return candidate;
      });

    if (frames.length === 0) {
      throw new Error(`Replay file ${this.inputPath} does not contain any market snapshots`);
    }

    this.frames = frames;
    return frames;
  }
}

function computeReplayDelay(
  currentTimestamp: number,
  nextTimestamp: number,
  fallbackIntervalMs: number,
  speedMultiplier: number,
): number {
  const delta = nextTimestamp - currentTimestamp;
  if (!Number.isFinite(delta) || delta <= 0) {
    return fallbackIntervalMs;
  }

  return Math.max(Math.floor(delta / speedMultiplier), 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBookLevelArray(value: unknown): value is Array<{ price: number; size: number }> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) && typeof entry.price === "number" && typeof entry.size === "number",
    )
  );
}

function isMarketSnapshot(value: unknown): value is MarketSnapshot {
  return (
    isRecord(value) &&
    typeof value.marketId === "string" &&
    typeof value.tokenId === "string" &&
    typeof value.timestamp === "number" &&
    isBookLevelArray(value.bids) &&
    isBookLevelArray(value.asks) &&
    typeof value.tickSize === "number" &&
    typeof value.minOrderSize === "number" &&
    typeof value.negRisk === "boolean" &&
    (typeof value.lastTradePrice === "number" || value.lastTradePrice === null) &&
    (typeof value.midpoint === "number" || value.midpoint === null) &&
    (typeof value.bookHash === "string" || value.bookHash === null) &&
    (value.source === "live" || value.source === "replay")
  );
}
