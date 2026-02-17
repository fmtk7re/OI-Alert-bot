import type { Database } from "bun:sqlite";
import { getOiHistory } from "../../db/queries.ts";
import { computeEma } from "../../lib/ema.ts";
import type { Alert } from "../types.ts";

/**
 * Rule 3: ema-cross
 * Detect when EMA(short) crosses below EMA(long) — bearish cross on rank numbers.
 * Since lower rank = higher OI, a bearish cross on rank means OI is surging.
 * Rank decreasing = EMA(short) < EMA(long) and previously was above.
 *
 * Severity: medium fixed.
 */
export function detectEmaCross(opts: {
  readonly db: Database;
  readonly symbol: string;
  readonly ts: string;
  readonly shortPeriod: number;
  readonly longPeriod: number;
}): Alert | null {
  const { db, symbol, shortPeriod, longPeriod } = opts;

  // Need at least longPeriod + 1 data points to detect a cross
  const minDataPoints = longPeriod + 1;
  const history = getOiHistory(db, symbol, minDataPoints + 10);

  if (history.length < minDataPoints) return null;

  // history is DESC from query, reverse for oldest→newest
  const ranks = [...history].reverse().map((r) => r.oi_rank);

  const shortEmas = computeEma(ranks, shortPeriod);
  const longEmas = computeEma(ranks, longPeriod);

  if (shortEmas.length < 2 || longEmas.length < 2) return null;

  // Align EMA arrays: both computed from same base, but short has more points.
  // We need to compare the last two values from each.
  const shortCurrent = shortEmas[shortEmas.length - 1]!;
  const shortPrev = shortEmas[shortEmas.length - 2]!;
  const longCurrent = longEmas[longEmas.length - 1]!;
  const longPrev = longEmas[longEmas.length - 2]!;

  // Bearish cross on rank: short EMA was >= long EMA, now short < long
  // This means rank improved (decreased) rapidly — OI is surging
  const wasBearish = shortPrev >= longPrev;
  const nowBearish = shortCurrent < longCurrent;

  if (!(wasBearish && nowBearish)) return null;

  const currentRank = ranks[ranks.length - 1]!;
  const prevRank = ranks[0]!;
  const delta = prevRank - currentRank;

  return {
    symbol,
    rule: "ema-cross",
    severity: "medium",
    currentRank,
    previousRank: prevRank,
    delta: Math.max(delta, 0),
    windowMinutes: history.length,
  };
}
