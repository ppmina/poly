import {
  DEFAULT_ACCURACY_BAND,
  DEFAULT_PREDICTION_CADENCE_MS,
  DEFAULT_RESOLVED_SERIES_WINDOW_MS,
  DEFAULT_TRUTH_HORIZON_MS,
  buildPredictionPoint,
  buildResolvedSeries,
  calculateRollingAccuracy,
  settlePredictionQueue,
  type PredictionPoint,
  type ResearchDashboardState,
  type ResearchSignalState,
  type ResolvedEvaluation,
} from "@poly/trader-core/research/evaluation";
import type { MarketSnapshot, SignalSnapshot } from "@poly/trader-core/types";

const DEFAULT_RECENT_EVALUATION_LIMIT = 25;
const DEFAULT_ROLLING_ACCURACY_WINDOW = 25;
const DEFAULT_RESOLVED_HISTORY_LIMIT = 240;
const DEFAULT_SIGNAL_UNAVAILABLE_MESSAGE = "Waiting for a fresh signal file.";

interface ResearchDashboardModelOptions {
  marketId: string;
  tokenId: string;
  accuracyBand?: number;
  predictionCadenceMs?: number;
  recentEvaluationLimit?: number;
  resolvedHistoryLimit?: number;
  resolvedSeriesWindowMs?: number;
  rollingAccuracyWindow?: number;
  truthHorizonMs?: number;
}

interface HandleSnapshotResult {
  latestPrediction: PredictionPoint | null;
  resolved: ResolvedEvaluation[];
}

export class ResearchDashboardModel {
  private connectionState: ResearchDashboardState["connectionState"] = "connecting";
  private latestPrediction: PredictionPoint | null = null;
  private latestResolved: ResolvedEvaluation | null = null;
  private latestSnapshot: MarketSnapshot | null = null;
  private lastSampleAt: number | null = null;
  private pending: PredictionPoint[] = [];
  private resolved: ResolvedEvaluation[] = [];
  private signalState: ResearchSignalState = {
    status: "unavailable",
    confidence: null,
    timestamp: null,
    fairValueAdjBps: null,
    message: DEFAULT_SIGNAL_UNAVAILABLE_MESSAGE,
  };

  private readonly accuracyBand: number;
  private readonly marketId: string;
  private readonly predictionCadenceMs: number;
  private readonly recentEvaluationLimit: number;
  private readonly resolvedHistoryLimit: number;
  private readonly resolvedSeriesWindowMs: number;
  private readonly rollingAccuracyWindow: number;
  private readonly tokenId: string;
  private readonly truthHorizonMs: number;

  public constructor(options: ResearchDashboardModelOptions) {
    this.marketId = options.marketId;
    this.tokenId = options.tokenId;
    this.accuracyBand = options.accuracyBand ?? DEFAULT_ACCURACY_BAND;
    this.predictionCadenceMs = options.predictionCadenceMs ?? DEFAULT_PREDICTION_CADENCE_MS;
    this.truthHorizonMs = options.truthHorizonMs ?? DEFAULT_TRUTH_HORIZON_MS;
    this.recentEvaluationLimit =
      options.recentEvaluationLimit ?? DEFAULT_RECENT_EVALUATION_LIMIT;
    this.rollingAccuracyWindow =
      options.rollingAccuracyWindow ?? DEFAULT_ROLLING_ACCURACY_WINDOW;
    this.resolvedHistoryLimit = options.resolvedHistoryLimit ?? DEFAULT_RESOLVED_HISTORY_LIMIT;
    this.resolvedSeriesWindowMs =
      options.resolvedSeriesWindowMs ?? DEFAULT_RESOLVED_SERIES_WINDOW_MS;
  }

  public handleSnapshot(
    snapshot: MarketSnapshot,
    signal: SignalSnapshot | null,
  ): HandleSnapshotResult {
    this.latestSnapshot = snapshot;
    this.connectionState = "live";
    this.signalState = buildSignalState(signal);

    let latestPrediction: PredictionPoint | null = null;
    if (this.shouldSample(snapshot.timestamp)) {
      this.lastSampleAt = snapshot.timestamp;
      latestPrediction = buildPredictionPoint(snapshot, signal);
      if (latestPrediction) {
        this.latestPrediction = latestPrediction;
        this.pending.push(latestPrediction);
      }
    }

    const settlement = settlePredictionQueue(this.pending, snapshot, {
      accuracyBand: this.accuracyBand,
      truthHorizonMs: this.truthHorizonMs,
    });
    this.pending = settlement.remaining;

    if (settlement.resolved.length > 0) {
      this.resolved.push(...settlement.resolved);
      if (this.resolved.length > this.resolvedHistoryLimit) {
        this.resolved = this.resolved.slice(-this.resolvedHistoryLimit);
      }
      this.latestResolved = settlement.resolved.at(-1) ?? this.latestResolved;
    }

    return {
      latestPrediction,
      resolved: settlement.resolved,
    };
  }

  public markStreamInterrupted(): void {
    this.connectionState = this.latestSnapshot ? "reconnecting" : "error";
  }

  public buildState(): ResearchDashboardState {
    const recentEvaluations = this.resolved.slice(-this.recentEvaluationLimit).reverse();
    const rollingWindow = this.resolved.slice(-this.rollingAccuracyWindow);
    const resolvedSeries = buildResolvedSeries(this.resolved, {
      ...(this.latestSnapshot ? { now: this.latestSnapshot.timestamp } : {}),
      windowMs: this.resolvedSeriesWindowMs,
    });

    return {
      connectionState: this.connectionState,
      market: {
        marketId: this.marketId,
        tokenId: this.tokenId,
        source: this.latestSnapshot?.source ?? null,
        lastSnapshotAt: this.latestSnapshot?.timestamp ?? null,
        currentMidpoint: this.latestSnapshot?.midpoint ?? null,
        tickSize: this.latestSnapshot?.tickSize ?? null,
        predictionCadenceMs: this.predictionCadenceMs,
        truthHorizonMs: this.truthHorizonMs,
        accuracyBand: this.accuracyBand,
      },
      signalState: this.signalState,
      pendingCount: this.pending.length,
      rollingAccuracy: calculateRollingAccuracy(rollingWindow),
      latestPrediction: this.latestPrediction,
      latestResolved: this.latestResolved,
      resolvedSeries,
      recentEvaluations,
    };
  }

  private shouldSample(timestamp: number): boolean {
    return this.lastSampleAt === null || timestamp - this.lastSampleAt >= this.predictionCadenceMs;
  }
}

function buildSignalState(signal: SignalSnapshot | null): ResearchSignalState {
  if (!signal) {
    return {
      status: "unavailable",
      confidence: null,
      timestamp: null,
      fairValueAdjBps: null,
      message: DEFAULT_SIGNAL_UNAVAILABLE_MESSAGE,
    };
  }

  return {
    status: "ready",
    confidence: signal.confidence,
    timestamp: signal.timestamp,
    fairValueAdjBps: signal.fairValueAdjBps,
    message: null,
  };
}
