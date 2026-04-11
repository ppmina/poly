import { describe, expect, it } from "vitest";

import { buildLivelineSeries, buildReplaySnapshot, formatMetricValue } from "../src/index";

describe("buildLivelineSeries", () => {
  it("filters the selected drivers into liveline format", () => {
    const snapshot = buildReplaySnapshot("indycar", "race", 140);
    const selectedIds = snapshot.drivers.slice(0, 2).map((driver) => driver.driverId);
    const series = buildLivelineSeries(snapshot, "gap_to_leader", selectedIds);

    expect(series).toHaveLength(2);
    expect(series[0]?.data.length).toBeGreaterThan(0);
    expect(series[0]?.label).toBe(snapshot.drivers[0]?.shortLabel);
  });

  it("formats transformed position values back into race positions", () => {
    expect(formatMetricValue("position_history", 8, 8)).toBe("P1");
    expect(formatMetricValue("position_history", 5, 8)).toBe("P4");
  });
});
