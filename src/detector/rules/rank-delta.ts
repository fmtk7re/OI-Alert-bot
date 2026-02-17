import type { Database } from "bun:sqlite";
import { getOiRankAt, getLatestOiRank } from "../../db/queries.ts";
import type { Alert, Severity } from "../types.ts";

function classifySeverity(delta: number): Severity {
  if (delta >= 100) return "high";
  if (delta >= 50) return "medium";
  return "low";
}

/**
 * Rule 1: rank-delta
 * Compare current rank with rank at T minutes ago.
 * Alert if rank improved (decreased) by >= threshold.
 * Rank decrease = OI increase.
 */
export function detectRankDelta(opts: {
  readonly db: Database;
  readonly symbol: string;
  readonly ts: string;
  readonly windowMin: number;
  readonly threshold: number;
}): Alert | null {
  const { db, symbol, ts, windowMin, threshold } = opts;

  const current = getLatestOiRank(db, symbol);
  if (!current) return null;

  const pastDate = new Date(new Date(ts).getTime() - windowMin * 60_000);
  const pastTs = pastDate.toISOString();
  const previous = getOiRankAt(db, symbol, pastTs);
  if (!previous) return null;

  // Delta: positive means rank improved (moved up = number decreased)
  const delta = previous.oi_rank - current.oi_rank;
  if (delta < threshold) return null;

  return {
    symbol,
    rule: "rank-delta",
    severity: classifySeverity(delta),
    currentRank: current.oi_rank,
    previousRank: previous.oi_rank,
    delta,
    windowMinutes: windowMin,
  };
}
