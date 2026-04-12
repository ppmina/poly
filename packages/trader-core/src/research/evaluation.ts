import type { MarketSnapshot, SignalSnapshot } from "../types.js";
import { estimateFairValue } from "../strategy/fairValue.js";
import { asFixedNumber, bpsToPrice, clamp } from "../utils/number.js";

export const DEFAULT_PREDICTION_CADENCE_MS = 30_000;
export const DEFAULT_TRUTH_HORIZON_MS = 5 * 60_000;
export const DEFAULT_ACCURACY_BAND = 0.02;
export const DEFAULT_RESOLVED_SERIES_WINDOW_MS = 60 * 60_000;

export interface PredictionPoint {
  predictedAt: number;
  marketId: string;
  midpointAtPrediction: number;
  baseFairValue: number;
  predictionValue: number;
  confidence: number;
}

export interface ResolvedEvaluation {
  predictedAt: number;
  truthAt: number;
  predictionValue: number;
  truthValue: number;
  diff: number;
  accurate: boolean;
  confidence: number;
}

export interface ResolvedSeriesPoint {
  time: number;
  predictionValue: number;
  truthValue: number;
  accurate: boolean;
}

export type ResearchConnectionState = "connecting" | "live" | "reconnecting" | "error";

export interface ResearchDashboardMarket {
  marketId: string;
  tokenId: string;
  source: MarketSnapshot["source"] | null;
  lastSnapshotAt: number | null;
  currentMidpoint: number | null;
  tickSize: number | null;
  predictionCadenceMs: number;
  truthHorizonMs: number;
  accuracyBand: number;
}

export interface ResearchSignalState {
  status: "ready" | "unavailable";
  confidence: number | null;
  timestamp: number | null;
  fairValueAdjBps: number | null;
  message: string | null;
}

export interface ResearchDashboardState {
  connectionState: ResearchConnectionState;
  market: ResearchDashboardMarket;
  signalState: ResearchSignalState;
  pendingCount: number;
  rollingAccuracy: number | null;
  latestPrediction: PredictionPoint | null;
  latestResolved: ResolvedEvaluation | null;
  resolvedSeries: ResolvedSeriesPoint[];
  recentEvaluations: ResolvedEvaluation[];
}

interface SettlePredictionQueueOptions {
  accuracyBand?: number;
  truthHorizonMs?: number;
}

interface BuildResolvedSeriesOptions {
  now?: number;
  windowMs?: number;
}

export function buildPredictionPoint(
  snapshot: MarketSnapshot,
  signal: SignalSnapshot | null,
): PredictionPoint | null {
  if (!signal) {
    return null;
  }

  if (snapshot.marketId !== signal.marketId) {
    return null;
  }

  if (snapshot.midpoint === null) {
    return null;
  }

  const estimate = estimateFairValue(snapshot);
  if (estimate.fairValue === null) {
    return null;
  }

  const predictionValue = clamp(
    asFixedNumber(estimate.fairValue + bpsToPrice(signal.fairValueAdjBps), 6),
    snapshot.tickSize,
    1 - snapshot.tickSize,
  );

  return {
    predictedAt: snapshot.timestamp,
    marketId: snapshot.marketId,
    midpointAtPrediction: snapshot.midpoint,
    baseFairValue: estimate.fairValue,
    predictionValue,
    confidence: signal.confidence,
  };
}

export function resolveEvaluation(
  prediction: PredictionPoint,
  truthValue: number,
  truthAt: number,
  accuracyBand = DEFAULT_ACCURACY_BAND,
): ResolvedEvaluation {
  const normalizedTruthValue = asFixedNumber(truthValue, 6);
  const diff = asFixedNumber(prediction.predictionValue - normalizedTruthValue, 6);

  return {
    predictedAt: prediction.predictedAt,
    truthAt,
    predictionValue: prediction.predictionValue,
    truthValue: normalizedTruthValue,
    diff,
    accurate: Math.abs(diff) <= accuracyBand,
    confidence: prediction.confidence,
  };
}

export function settlePredictionQueue(
  pending: readonly PredictionPoint[],
  snapshot: MarketSnapshot,
  options: SettlePredictionQueueOptions = {},
): { resolved: ResolvedEvaluation[]; remaining: PredictionPoint[] } {
  if (snapshot.midpoint === null || pending.length === 0) {
    return {
      resolved: [],
      remaining: pending as PredictionPoint[],
    };
  }

  const accuracyBand = options.accuracyBand ?? DEFAULT_ACCURACY_BAND;
  const truthHorizonMs = options.truthHorizonMs ?? DEFAULT_TRUTH_HORIZON_MS;
  const resolved: ResolvedEvaluation[] = [];

  let index = 0;
  while (index < pending.length) {
    const candidate = pending[index]!;
    if (snapshot.timestamp < candidate.predictedAt + truthHorizonMs) {
      break;
    }

    resolved.push(resolveEvaluation(candidate, snapshot.midpoint, snapshot.timestamp, accuracyBand));
    index += 1;
  }

  return {
    resolved,
    remaining: pending.slice(index),
  };
}

export function calculateRollingAccuracy(
  evaluations: readonly ResolvedEvaluation[],
): number | null {
  if (evaluations.length === 0) {
    return null;
  }

  const accurateCount = evaluations.filter((evaluation) => evaluation.accurate).length;
  return asFixedNumber(accurateCount / evaluations.length, 4);
}

export function buildResolvedSeries(
  evaluations: readonly ResolvedEvaluation[],
  options: BuildResolvedSeriesOptions = {},
): ResolvedSeriesPoint[] {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_RESOLVED_SERIES_WINDOW_MS;
  const cutoff = now - windowMs;

  return evaluations
    .filter((evaluation) => evaluation.predictedAt >= cutoff)
    .map((evaluation) => ({
      time: evaluation.predictedAt,
      predictionValue: evaluation.predictionValue,
      truthValue: evaluation.truthValue,
      accurate: evaluation.accurate,
    }));
}
