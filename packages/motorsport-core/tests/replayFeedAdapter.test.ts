import { describe, expect, it } from "vitest";

import { buildReplaySnapshot, createReplayFeedAdapter } from "../src/index";

describe("ReplayFeedAdapter", () => {
  it("exposes configured sessions for a series", () => {
    const adapter = createReplayFeedAdapter();
    const sessions = adapter.listSessions("f1");

    expect(sessions.map((session) => session.id)).toContain("race");
    expect(sessions.length).toBeGreaterThan(1);
  });

  it("builds a snapshot with driver history", () => {
    const snapshot = buildReplaySnapshot("f1", "race", 180);

    expect(snapshot.drivers.length).toBeGreaterThan(4);
    expect(snapshot.drivers[0]?.gapToLeader).toBe(0);
    expect(snapshot.drivers[0]?.metrics.gap_to_leader.length).toBeGreaterThan(10);

    const positions = snapshot.drivers.map((driver) => driver.position);
    expect(new Set(positions).size).toBe(snapshot.drivers.length);
  });
});
