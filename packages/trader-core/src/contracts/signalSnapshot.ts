import { z } from "zod";

import type { SignalSnapshot } from "../types.js";

function normalizeTimestamp(value: number | string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = String(value);
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) {
    return asNumber;
  }

  const asDate = Date.parse(text);
  if (Number.isFinite(asDate)) {
    return asDate;
  }

  throw new Error(`Invalid timestamp value: ${value}`);
}

export const signalSnapshotSchema = z
  .object({
    marketId: z.string().min(1),
    timestamp: z.union([z.number().finite(), z.string().min(1)]).transform(normalizeTimestamp),
    fairValueAdjBps: z.number().finite(),
    inventoryBias: z.number().min(-1).max(1),
    confidence: z.number().min(0).max(1),
  })
  .transform((value) => value as SignalSnapshot);

export function parseSignalSnapshot(input: unknown): SignalSnapshot {
  return signalSnapshotSchema.parse(input);
}
