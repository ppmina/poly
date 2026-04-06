import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FileSignalSource } from "../src/signals/fileSignalSource.js";
import { createNoopLogger } from "./helpers.js";

describe("FileSignalSource", () => {
  it("loads a valid signal file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "poly-signal-"));
    const path = join(dir, "signal.json");
    await writeFile(
      path,
      JSON.stringify({
        marketId: "market-1",
        timestamp: Date.now(),
        fairValueAdjBps: 25,
        inventoryBias: 0.1,
        confidence: 0.9,
      }),
      "utf8",
    );

    const signal = await new FileSignalSource(path, 5_000, createNoopLogger()).read("market-1");
    expect(signal?.fairValueAdjBps).toBe(25);
  });

  it("ignores stale or cross-market signals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "poly-signal-"));
    const stalePath = join(dir, "stale.json");
    await writeFile(
      stalePath,
      JSON.stringify({
        marketId: "market-2",
        timestamp: Date.now() - 60_000,
        fairValueAdjBps: 25,
        inventoryBias: 0.1,
        confidence: 0.9,
      }),
      "utf8",
    );

    const signal = await new FileSignalSource(stalePath, 5_000, createNoopLogger()).read(
      "market-1",
    );
    expect(signal).toBeNull();
  });
});
