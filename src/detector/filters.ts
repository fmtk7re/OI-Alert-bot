import type { Database } from "bun:sqlite";
import { getLastAlertTime, getLastAlertCurrentRank, getLatestFrForSymbol } from "../db/queries.ts";
import type { Alert, Severity } from "./types.ts";

/**
 * Filter 1: maxRank — only alert if current rank <= maxRank
 */
export function filterMaxRank(alert: Alert, maxRank: number): boolean {
  return alert.currentRank <= maxRank;
}

/**
 * Filter 2: cooldown — suppress if same symbol+rule alerted within cooldownMin.
 * High severity alerts get halved cooldown to allow faster re-notification.
 */
export function filterCooldown(
  db: Database,
  alert: Alert,
  cooldownMin: number,
  currentTs: string,
): boolean {
  const lastSent = getLastAlertTime(db, alert.symbol, alert.rule);
  if (!lastSent) return true;

  const effectiveCooldown = alert.severity === "high" ? Math.floor(cooldownMin / 2) : cooldownMin;
  const lastTime = new Date(lastSent).getTime();
  const now = new Date(currentTs).getTime();
  return now - lastTime >= effectiveCooldown * 60_000;
}

/**
 * Filter 3: FR backing — at least one exchange has |FR| >= minAbsFr.
 * Returns the count of exchanges meeting the threshold for severity boosting.
 */
export function filterFrBacking(db: Database, alert: Alert, minAbsFr: number): boolean {
  const rates = getLatestFrForSymbol(db, alert.symbol);
  return rates.some((r) => Math.abs(r.rate) >= minAbsFr);
}

/**
 * Filter 4: duplicate content — suppress if current rank is identical to the last alert.
 * Prevents re-notification when the OI position hasn't moved since the previous alert.
 */
export function filterDuplicateContent(
  db: Database,
  alert: Alert,
): boolean {
  const lastRank = getLastAlertCurrentRank(db, alert.symbol, alert.rule);
  if (lastRank === null) return true;
  return alert.currentRank !== lastRank;
}

/**
 * Count how many exchanges have |FR| >= threshold.
 * Used for severity boosting — more exchanges backing = stronger signal.
 */
export function countFrBackingExchanges(
  db: Database,
  symbol: string,
  minAbsFr: number,
): number {
  const rates = getLatestFrForSymbol(db, symbol);
  return rates.filter((r) => Math.abs(r.rate) >= minAbsFr).length;
}

/**
 * Boost severity if multiple exchanges confirm FR backing.
 * - 3+ exchanges with |FR| >= threshold: low→medium, medium→high
 */
export function boostSeverity(baseSeverity: Severity, frBackingCount: number): Severity {
  if (frBackingCount < 3) return baseSeverity;
  if (baseSeverity === "low") return "medium";
  if (baseSeverity === "medium") return "high";
  return baseSeverity;
}

/**
 * Apply all filters in order. Returns the alert with potentially boosted severity,
 * or null if filtered out.
 */
export function applyFilters(opts: {
  readonly db: Database;
  readonly alert: Alert;
  readonly maxRank: number;
  readonly cooldownMin: number;
  readonly minAbsFr: number;
  readonly currentTs: string;
}): Alert | null {
  const { db, alert, maxRank, cooldownMin, minAbsFr, currentTs } = opts;

  if (!filterMaxRank(alert, maxRank)) return null;
  if (!filterCooldown(db, alert, cooldownMin, currentTs)) return null;
  if (!filterDuplicateContent(db, alert)) return null;
  if (!filterFrBacking(db, alert, minAbsFr)) return null;

  // Severity boost based on FR exchange consensus
  const frCount = countFrBackingExchanges(db, alert.symbol, minAbsFr);
  const boostedSeverity = boostSeverity(alert.severity, frCount);

  if (boostedSeverity !== alert.severity) {
    return { ...alert, severity: boostedSeverity };
  }

  return alert;
}
