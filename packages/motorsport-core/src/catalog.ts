import type { DriverProfile, SeriesDefinition, SeriesId, SessionDefinition } from "./types";
import { seriesIds } from "./types";

function driver(
  id: string,
  code: string,
  name: string,
  color: string,
  baseRating: number,
  variance: number,
  attack: number,
  phase: number,
): DriverProfile {
  return { id, code, name, color, baseRating, variance, attack, phase };
}

function session(
  id: string,
  label: string,
  kind: SessionDefinition["kind"],
  track: string,
  location: string,
  totalLaps: number,
  lapDurationSecs: number,
  historyWindowSecs = 120,
  sampleRateMs = 1000,
): SessionDefinition {
  return {
    id,
    label,
    kind,
    track,
    location,
    totalLaps,
    lapDurationSecs,
    historyWindowSecs,
    sampleRateMs,
  };
}

const seriesCatalog: readonly SeriesDefinition[] = [
  {
    id: "f1",
    name: "Formula 1",
    shortName: "F1",
    accentColor: "#ff6a3d",
    hero: "Grand prix gaps, intervals, and position swings in one live canvas.",
    drivers: [
      driver("max-verstappen", "VER", "Max Verstappen", "#1f5bc6", 9.8, 0.22, 0.24, 0.2),
      driver("lando-norris", "NOR", "Lando Norris", "#ff7a1a", 9.5, 0.28, 0.22, 1.2),
      driver("charles-leclerc", "LEC", "Charles Leclerc", "#dc2626", 9.2, 0.34, 0.25, 2.1),
      driver("oscar-piastri", "PIA", "Oscar Piastri", "#f97316", 9.15, 0.27, 0.19, 1.7),
      driver("lewis-hamilton", "HAM", "Lewis Hamilton", "#14b8a6", 9.0, 0.31, 0.23, 2.8),
      driver("george-russell", "RUS", "George Russell", "#0ea5e9", 8.95, 0.26, 0.2, 0.9),
      driver("fernando-alonso", "ALO", "Fernando Alonso", "#16a34a", 8.8, 0.38, 0.18, 3.2),
      driver("carlos-sainz", "SAI", "Carlos Sainz", "#ef4444", 8.75, 0.24, 0.21, 2.5),
    ],
    sessions: [
      session("race", "Race", "race", "Suzuka", "Japan", 53, 92),
      session("qualifying", "Qualifying", "qualifying", "Suzuka", "Japan", 18, 80),
      session("practice-2", "Practice 2", "practice", "Suzuka", "Japan", 24, 96),
    ],
  },
  {
    id: "indycar",
    name: "IndyCar",
    shortName: "Indy",
    accentColor: "#ffcd1f",
    hero: "Oval and road-course momentum with stackable driver traces.",
    drivers: [
      driver("alex-palou", "PAL", "Alex Palou", "#1d4ed8", 9.65, 0.18, 0.22, 0.6),
      driver("josef-newgarden", "NEW", "Josef Newgarden", "#ef4444", 9.3, 0.24, 0.28, 1.6),
      driver("pato-oward", "POW", "Pato O'Ward", "#f97316", 9.05, 0.33, 0.24, 1.1),
      driver("scott-dixon", "DIX", "Scott Dixon", "#111827", 8.95, 0.21, 0.16, 2.8),
      driver("colton-herta", "HER", "Colton Herta", "#22c55e", 8.9, 0.36, 0.25, 0.3),
      driver("will-power", "POW2", "Will Power", "#ffffff", 8.85, 0.29, 0.2, 2.1),
    ],
    sessions: [
      session("race", "Race", "race", "Long Beach", "United States", 85, 76),
      session("qualifying", "Qualifying", "qualifying", "Long Beach", "United States", 14, 70),
    ],
  },
  {
    id: "wec",
    name: "WEC",
    shortName: "WEC",
    accentColor: "#f43f5e",
    hero: "Endurance snapshots with position churn across long-running stints.",
    drivers: [
      driver("toyota-7", "T7", "Toyota #7", "#ef4444", 9.55, 0.17, 0.14, 0.9),
      driver("toyota-8", "T8", "Toyota #8", "#dc2626", 9.45, 0.19, 0.15, 1.4),
      driver("ferrari-50", "F50", "Ferrari #50", "#f97316", 9.25, 0.26, 0.23, 2.7),
      driver("ferrari-51", "F51", "Ferrari #51", "#fb7185", 9.1, 0.24, 0.19, 1.8),
      driver("porsche-6", "P6", "Porsche #6", "#f5f5f4", 9.0, 0.22, 0.18, 0.4),
      driver("cadillac-2", "C2", "Cadillac #2", "#60a5fa", 8.88, 0.31, 0.24, 2.3),
    ],
    sessions: [
      session("race", "6 Hours", "race", "Spa-Francorchamps", "Belgium", 148, 145),
      session("qualifying", "Hyperpole", "qualifying", "Spa-Francorchamps", "Belgium", 10, 130),
    ],
  },
  {
    id: "formula-e",
    name: "Formula E",
    shortName: "FE",
    accentColor: "#7c3aed",
    hero: "Energy-management theater with rapid attack-mode swings.",
    drivers: [
      driver("jake-dennis", "DEN", "Jake Dennis", "#7c3aed", 9.15, 0.29, 0.22, 1.5),
      driver("pascal-wehrlein", "WEH", "Pascal Wehrlein", "#111827", 9.32, 0.21, 0.18, 0.2),
      driver("mitch-evans", "EVA", "Mitch Evans", "#0ea5e9", 9.1, 0.33, 0.26, 2.2),
      driver("nick-cassidy", "CAS", "Nick Cassidy", "#22c55e", 9.05, 0.27, 0.21, 2.9),
      driver("jean-eric-vergne", "VERG", "Jean-Eric Vergne", "#ef4444", 8.95, 0.31, 0.24, 0.7),
      driver("oliver-rowland", "ROW", "Oliver Rowland", "#f59e0b", 8.9, 0.34, 0.27, 3.1),
    ],
    sessions: [
      session("race", "E-Prix", "race", "Monaco", "Monaco", 32, 108),
      session("duels", "Duels", "qualifying", "Monaco", "Monaco", 8, 78),
    ],
  },
] as const;

export function getSeriesCatalog(): readonly SeriesDefinition[] {
  return seriesCatalog;
}

export function getSeriesDefinition(seriesId: SeriesId): SeriesDefinition | undefined {
  return seriesCatalog.find((series) => series.id === seriesId);
}

export function getSessionDefinition(
  seriesId: SeriesId,
  sessionId: string,
): SessionDefinition | undefined {
  return getSeriesDefinition(seriesId)?.sessions.find((session) => session.id === sessionId);
}

export function isSeriesId(value: string): value is SeriesId {
  return (seriesIds as readonly string[]).includes(value);
}
