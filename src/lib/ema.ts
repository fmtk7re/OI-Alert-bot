/**
 * Compute EMA (Exponential Moving Average) for a series of numeric values.
 * Values should be ordered from oldest to newest.
 */
export function computeEma(values: ReadonlyArray<number>, period: number): ReadonlyArray<number> {
  if (values.length === 0 || period < 1) return [];

  const k = 2 / (period + 1);
  const result: number[] = [];

  // First value is the SMA of the first `period` values (or all if less)
  const seedCount = Math.min(period, values.length);
  let sum = 0;
  for (let i = 0; i < seedCount; i++) {
    sum += values[i]!;
  }
  let ema = sum / seedCount;
  result.push(ema);

  for (let i = seedCount; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
    result.push(ema);
  }

  return result;
}

/**
 * Get the latest EMA value for a series.
 * Returns null if insufficient data.
 */
export function latestEma(values: ReadonlyArray<number>, period: number): number | null {
  const emas = computeEma(values, period);
  return emas.length > 0 ? emas[emas.length - 1]! : null;
}
