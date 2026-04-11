import type { ChartMetric, LivelineSeriesInput, SessionSnapshot } from "../types";

export interface MetricMeta {
  label: string;
  subtitle: string;
}

const metricMeta: Record<ChartMetric, MetricMeta> = {
  gap_to_leader: {
    label: "Gap To Leader",
    subtitle: "Track who is building margin over a race distance.",
  },
  interval_ahead: {
    label: "Interval Ahead",
    subtitle: "Focus on the fight directly in front of each selected car.",
  },
  position_history: {
    label: "Position History",
    subtitle: "See overtakes and defensive holds as the order breathes.",
  },
};

export function getMetricMeta(metric: ChartMetric): MetricMeta {
  return metricMeta[metric];
}

export function buildLivelineSeries(
  snapshot: SessionSnapshot,
  metric: ChartMetric,
  selectedDriverIds: readonly string[] = [],
): LivelineSeriesInput[] {
  const selectedSet = selectedDriverIds.length > 0 ? new Set(selectedDriverIds) : null;
  const maxPosition = snapshot.drivers.length;

  return snapshot.drivers
    .filter((driver) => (selectedSet ? selectedSet.has(driver.driverId) : true))
    .map((driver) => {
      const data = driver.metrics[metric].map((point) => ({
        time: point.time,
        value: metric === "position_history" ? maxPosition + 1 - point.value : point.value,
      }));

      return {
        id: driver.driverId,
        label: driver.shortLabel,
        color: driver.color,
        data,
        value: data.at(-1)?.value ?? 0,
      };
    });
}

export function formatMetricValue(metric: ChartMetric, value: number, driverCount: number): string {
  if (metric === "position_history") {
    const position = Math.max(1, Math.min(driverCount, driverCount + 1 - Math.round(value)));
    return `P${position}`;
  }

  return `+${value.toFixed(2)}s`;
}

export function formatSessionClock(sessionClockSec: number): string {
  const minutes = Math.floor(sessionClockSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(sessionClockSec % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}
