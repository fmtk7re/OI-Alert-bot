import type { Database } from "bun:sqlite";
import { getLatestOiRank, getPreviousOiRank } from "../../db/queries.ts";
import type { Alert } from "../types.ts";

/**
 * Rule 2: new-entry
 * Detect symbols that were previously 500+ (rank 501) and are now <= 500.
 * Also fires when a symbol appears for the first time (no previous data).
 * Severity: high fixed.
 */
export function detectNewEntry(opts: {
  readonly db: Database;
  readonly symbol: string;
  readonly ts: string;
  readonly pollIntervalMs: number;
}): Alert | null {
  const { db, symbol, pollIntervalMs } = opts;

  const current = getLatestOiRank(db, symbol);
  if (!current) return null;
  if (current.oi_rank > 500) return null;

  // Compare with the second-latest snapshot
  const previous = getPreviousOiRank(db, symbol);

  // If previous data exists and wasn't 501 (500+), this isn't a new entry
  if (previous && previous.oi_rank !== 501) return null;

  const previousRank = previous?.oi_rank ?? 501;
  const delta = previousRank - current.oi_rank;
  const windowMinutes = Math.round((pollIntervalMs * 2) / 60_000);

  return {
    symbol,
    rule: "new-entry",
    severity: "high",
    currentRank: current.oi_rank,
    previousRank,
    delta,
    windowMinutes,
  };
}
