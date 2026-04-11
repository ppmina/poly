import { getSeriesCatalog, getSeriesDefinition, getSessionDefinition } from "../catalog";
import type {
  ChartMetric,
  DriverProfile,
  DriverSnapshot,
  FeedAdapter,
  FeedStreamOptions,
  MetricPoint,
  SeriesDefinition,
  SeriesId,
  SessionSnapshot,
} from "../types";

function createEmptyHistory(): Record<ChartMetric, MetricPoint[]> {
  return {
    gap_to_leader: [],
    interval_ahead: [],
    position_history: [],
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function scoreDriver(
  driver: DriverProfile,
  driverIndex: number,
  tick: number,
  sessionBias: number,
): number {
  const cadence = 0.13 + driverIndex * 0.015;
  const rhythm = Math.sin(tick * cadence + driver.phase) * driver.variance;
  const harmonic = Math.cos(tick * (cadence / 2.25) + driver.phase * 1.7) * driver.variance * 0.65;
  const push = Math.sin((tick + driverIndex * 11) / 27) * driver.attack;
  const management = Math.cos((tick + sessionBias * 6) / 41) * 0.14;

  return driver.baseRating + rhythm + harmonic + push + management;
}

function leaderboardAtTick(series: SeriesDefinition, tick: number): DriverSnapshot[] {
  const scoredDrivers = series.drivers
    .map((driver, index) => ({
      driver,
      score: scoreDriver(driver, index, tick, series.drivers.length / 10),
    }))
    .sort((left, right) => right.score - left.score);

  const leaderScore = scoredDrivers[0]?.score ?? 0;

  return scoredDrivers.map((entry, index, ordered) => {
    const gapToLeader = index === 0 ? 0 : round(leaderScore - entry.score + index * 0.18);
    const previousGap =
      index === 0
        ? 0
        : round(leaderScore - (ordered[index - 1]?.score ?? leaderScore) + (index - 1) * 0.18);

    return {
      driverId: entry.driver.id,
      label: entry.driver.name,
      shortLabel: entry.driver.code,
      color: entry.driver.color,
      position: index + 1,
      gapToLeader,
      intervalAhead: index === 0 ? 0 : round(Math.max(0.12, gapToLeader - previousGap)),
      latestLap: 0,
      metrics: {
        gap_to_leader: [],
        interval_ahead: [],
        position_history: [],
      },
    };
  });
}

function buildHistory(
  series: SeriesDefinition,
  sessionId: string,
  frame: number,
  historyWindowSecs: number,
): Map<string, Record<ChartMetric, MetricPoint[]>> {
  const history = new Map<string, Record<ChartMetric, MetricPoint[]>>();
  const baselineSeconds = Math.floor(Date.now() / 1000);
  const startFrame = Math.max(0, frame - historyWindowSecs + 1);

  for (const driver of series.drivers) {
    history.set(driver.id, createEmptyHistory());
  }

  for (let tick = startFrame; tick <= frame; tick += 1) {
    const timestamp = baselineSeconds - (frame - tick);
    const leaderboard = leaderboardAtTick(series, tick + sessionId.length);

    for (const driver of leaderboard) {
      const bucket = history.get(driver.driverId);
      if (!bucket) {
        continue;
      }

      bucket.gap_to_leader.push({ time: timestamp, value: driver.gapToLeader });
      bucket.interval_ahead.push({ time: timestamp, value: driver.intervalAhead });
      bucket.position_history.push({ time: timestamp, value: driver.position });
    }
  }

  return history;
}

export function buildReplaySnapshot(
  seriesId: SeriesId,
  sessionId: string,
  frame = 140,
): SessionSnapshot {
  const series = getSeriesDefinition(seriesId);
  if (!series) {
    throw new Error(`Unknown series: ${seriesId}`);
  }

  const session = getSessionDefinition(seriesId, sessionId);
  if (!session) {
    throw new Error(`Unknown session: ${sessionId}`);
  }

  const history = buildHistory(series, sessionId, frame, session.historyWindowSecs);
  const current = leaderboardAtTick(series, frame + session.id.length).map((driver) => ({
    ...driver,
    latestLap: Math.min(session.totalLaps, Math.floor(frame / session.lapDurationSecs) + 1),
    metrics: history.get(driver.driverId) ?? createEmptyHistory(),
  }));

  return {
    seriesId,
    seriesName: series.name,
    sessionId: session.id,
    sessionLabel: session.label,
    track: session.track,
    location: session.location,
    status: "demo",
    generatedAt: Date.now(),
    sessionClockSec: frame,
    lap: Math.min(session.totalLaps, Math.floor(frame / session.lapDurationSecs) + 1),
    totalLaps: session.totalLaps,
    drivers: current,
  };
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }

  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

class ReplayFeedAdapter implements FeedAdapter {
  public listSeries(): readonly SeriesDefinition[] {
    return getSeriesCatalog();
  }

  public listSessions(seriesId: SeriesId) {
    return getSeriesDefinition(seriesId)?.sessions ?? [];
  }

  public getSeries(seriesId: SeriesId) {
    return getSeriesDefinition(seriesId);
  }

  public getSession(seriesId: SeriesId, sessionId: string) {
    return getSessionDefinition(seriesId, sessionId);
  }

  public async *streamSession(options: FeedStreamOptions): AsyncGenerator<SessionSnapshot> {
    const session = this.getSession(options.seriesId, options.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${options.sessionId}`);
    }

    let frame = options.startFrame ?? session.historyWindowSecs;

    while (!options.signal?.aborted) {
      yield buildReplaySnapshot(options.seriesId, options.sessionId, frame);
      frame += 1;
      await delay(session.sampleRateMs, options.signal);
    }
  }
}

export function createReplayFeedAdapter(): FeedAdapter {
  return new ReplayFeedAdapter();
}
