const EPSILON = 1e-9;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function bpsToPrice(bps: number): number {
  return bps / 10_000;
}

export function roundDownToTick(value: number, tickSize: number): number {
  return Math.floor((value + EPSILON) / tickSize) * tickSize;
}

export function roundUpToTick(value: number, tickSize: number): number {
  return Math.ceil((value - EPSILON) / tickSize) * tickSize;
}

export function nearlyEqual(left: number, right: number, tolerance = 1e-9): boolean {
  return Math.abs(left - right) <= tolerance;
}

export function asFixedNumber(value: number, decimals = 6): number {
  return Number(value.toFixed(decimals));
}
