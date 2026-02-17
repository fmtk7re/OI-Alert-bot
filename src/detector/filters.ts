import type { Database } from "bun:sqlite";
import { getLastAlertTime, getLatestFrForSymbol } from "../db/queries.ts";
import type { Alert } from "./types.ts";

/**
 * Filter 1: maxRank — only alert if current rank <= maxRank
 */
export function filterMaxRank(alert: Alert, maxRank: number): boolean {
  return alert.currentRank <= maxRank;
}

/**
 * Filter 2: cooldown — suppress if same symbol+rule alerted within cooldownMin
 */
export function filterCooldown(
  db: Database,
  alert: Alert,
  cooldownMin: number,
  currentTs: string,
): boolean {
  const lastSent = getLastAlertTime(db, alert.symbol, alert.rule);
  if (!lastSent) return true;

  const lastTime = new Date(lastSent).getTime();
  const now = new Date(currentTs).getTime();
  return now - lastTime >= cooldownMin * 60_000;
}

/**
 * Filter 3: FR backing — at least one exchange has |FR| >= minAbsFr
 */
export function filterFrBacking(db: Database, alert: Alert, minAbsFr: number): boolean {
  const rates = getLatestFrForSymbol(db, alert.symbol);
  return rates.some((r) => Math.abs(r.rate) >= minAbsFr);
}

/**
 * Apply all filters in order. Returns true if alert passes all filters.
 */
export function applyFilters(opts: {
  readonly db: Database;
  readonly alert: Alert;
  readonly maxRank: number;
  readonly cooldownMin: number;
  readonly minAbsFr: number;
  readonly currentTs: string;
}): boolean {
  const { db, alert, maxRank, cooldownMin, minAbsFr, currentTs } = opts;

  if (!filterMaxRank(alert, maxRank)) return false;
  if (!filterCooldown(db, alert, cooldownMin, currentTs)) return false;
  if (!filterFrBacking(db, alert, minAbsFr)) return false;

  return true;
}
