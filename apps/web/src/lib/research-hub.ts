import {
  type ResearchDashboardState,
} from "@poly/trader-core/research/evaluation";
import { JsonlArtifactStore } from "@poly/trader-core/artifacts/jsonlArtifactStore";
import type { AppConfig } from "@poly/trader-core/config";
import type { PolymarketGateway } from "@poly/trader-core/gateways/polymarketGateway";
import { JsonLogger } from "@poly/trader-core/logger";
import { createGateway } from "@poly/trader-core/runtime/bootstrap";
import { FileSignalSource } from "@poly/trader-core/signals/fileSignalSource";
import type { MarketSnapshot } from "@poly/trader-core/types";

import { ResearchDashboardModel } from "./research-dashboard";

type Listener = (state: ResearchDashboardState) => void;

const RESEARCH_EVALUATION_STREAM = "research-evaluations";

class ResearchHub {
  private readonly artifactStore: JsonlArtifactStore;
  private readonly gateway: PolymarketGateway;
  private readonly logger = new JsonLogger("poly-research-web");
  private readonly model: ResearchDashboardModel;
  private readonly signalSource: FileSignalSource;
  private readonly listeners = new Set<Listener>();

  private startPromise: Promise<void> | null = null;

  public constructor(private readonly config: AppConfig) {
    this.artifactStore = new JsonlArtifactStore(
      config.artifactsDir,
      this.logger.child("artifacts"),
    );
    this.gateway = createGateway(config, this.logger.child("gateway"));
    this.signalSource = new FileSignalSource(
      config.signalFilePath,
      config.signalMaxAgeMs,
      this.logger.child("signal"),
    );
    this.model = new ResearchDashboardModel({
      marketId: config.marketId,
      tokenId: config.tokenId,
    });
  }

  public getState(): ResearchDashboardState {
    return this.model.buildState();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async ensureStarted(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.start();
    }

    await this.startPromise;
  }

  private async start(): Promise<void> {
    this.broadcast();
    await this.gateway.connectMarketData(
      async (snapshot: MarketSnapshot) => {
        const signal = await this.signalSource.read(this.config.marketId, snapshot.timestamp);
        const result = this.model.handleSnapshot(snapshot, signal);

        for (const evaluation of result.resolved) {
          await this.artifactStore.append(RESEARCH_EVALUATION_STREAM, evaluation);
        }

        this.broadcast();
      },
      (error: unknown) => {
        this.logger.warn("Research market data interrupted", {
          error: error instanceof Error ? error.message : String(error),
          marketId: this.config.marketId,
          tokenId: this.config.tokenId,
        });
        this.model.markStreamInterrupted();
        this.broadcast();
      },
    );
  }

  private broadcast(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

let hub: ResearchHub | null = null;
let hubKey: string | null = null;

export function getResearchHub(config: AppConfig): ResearchHub {
  const nextKey = serializeConfig(config);
  if (!hub || hubKey !== nextKey) {
    hub = new ResearchHub(config);
    hubKey = nextKey;
  }

  return hub;
}

function serializeConfig(config: AppConfig): string {
  return JSON.stringify({
    artifactsDir: config.artifactsDir,
    marketId: config.marketId,
    replayInputPath: config.replayInputPath ?? null,
    signalFilePath: config.signalFilePath,
    tokenId: config.tokenId,
  });
}
