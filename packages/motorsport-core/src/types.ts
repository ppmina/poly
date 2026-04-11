export const seriesIds = ["f1", "indycar", "wec", "formula-e"] as const;
export type SeriesId = (typeof seriesIds)[number];

export const chartMetrics = ["gap_to_leader", "interval_ahead", "position_history"] as const;
export type ChartMetric = (typeof chartMetrics)[number];

export interface MetricPoint {
  time: number;
  value: number;
}

export interface LivelineSeriesInput {
  id: string;
  label: string;
  color: string;
  data: MetricPoint[];
  value: number;
}

export interface DriverProfile {
  id: string;
  code: string;
  name: string;
  color: string;
  baseRating: number;
  variance: number;
  attack: number;
  phase: number;
}

export interface SessionDefinition {
  id: string;
  label: string;
  kind: "race" | "qualifying" | "practice";
  track: string;
  location: string;
  totalLaps: number;
  lapDurationSecs: number;
  sampleRateMs: number;
  historyWindowSecs: number;
}

export interface SeriesDefinition {
  id: SeriesId;
  name: string;
  shortName: string;
  accentColor: string;
  hero: string;
  drivers: DriverProfile[];
  sessions: SessionDefinition[];
}

export interface DriverSnapshot {
  driverId: string;
  label: string;
  shortLabel: string;
  color: string;
  position: number;
  gapToLeader: number;
  intervalAhead: number;
  latestLap: number;
  metrics: Record<ChartMetric, MetricPoint[]>;
}

export interface SessionSnapshot {
  seriesId: SeriesId;
  seriesName: string;
  sessionId: string;
  sessionLabel: string;
  track: string;
  location: string;
  status: "demo" | "live";
  generatedAt: number;
  sessionClockSec: number;
  lap: number;
  totalLaps: number;
  drivers: DriverSnapshot[];
}

export interface FeedStreamOptions {
  seriesId: SeriesId;
  sessionId: string;
  signal?: AbortSignal;
  startFrame?: number;
}

export interface FeedAdapter {
  listSeries(): readonly SeriesDefinition[];
  listSessions(seriesId: SeriesId): readonly SessionDefinition[];
  getSeries(seriesId: SeriesId): SeriesDefinition | undefined;
  getSession(seriesId: SeriesId, sessionId: string): SessionDefinition | undefined;
  streamSession(options: FeedStreamOptions): AsyncGenerator<SessionSnapshot>;
}

