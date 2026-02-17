import type { Database } from "bun:sqlite";
import type pino from "pino";
import { detectRankDelta } from "./rules/rank-delta.ts";
import { detectNewEntry } from "./rules/new-entry.ts";
import { detectEmaCross } from "./rules/ema-cross.ts";
import { applyFilters } from "./filters.ts";
import type { Alert, DetectorContext } from "./types.ts";

type RuleStats = {
  rankDelta: number;
  newEntry: number;
  emaCross: number;
};

/**
 * Run detection for a single tick.
 * Returns alerts sorted by delta descending, capped at maxAlertsPerTick.
 */
export function runDetection(
  db: Database,
  ctx: DetectorContext,
  logger: pino.Logger,
): ReadonlyArray<Alert> {
  const rawAlerts: Alert[] = [];
  const stats: RuleStats = { rankDelta: 0, newEntry: 0, emaCross: 0 };

  for (const symbol of ctx.symbols) {
    // Rule 1: rank-delta
    const rankDeltaAlert = detectRankDelta({
      db,
      symbol,
      ts: ctx.ts,
      windowMin: ctx.rankDeltaWindowMin,
      threshold: ctx.rankDeltaThreshold,
    });
    if (rankDeltaAlert) {
      rawAlerts.push(rankDeltaAlert);
      stats.rankDelta++;
    }

    // Rule 2: new-entry
    const newEntryAlert = detectNewEntry({
      db,
      symbol,
      ts: ctx.ts,
      pollIntervalMs: ctx.pollIntervalMs,
    });
    if (newEntryAlert) {
      rawAlerts.push(newEntryAlert);
      stats.newEntry++;
    }

    // Rule 3: ema-cross
    const emaCrossAlert = detectEmaCross({
      db,
      symbol,
      ts: ctx.ts,
      shortPeriod: ctx.emaShortPeriod,
      longPeriod: ctx.emaLongPeriod,
    });
    if (emaCrossAlert) {
      rawAlerts.push(emaCrossAlert);
      stats.emaCross++;
    }
  }

  // Apply filters (returns Alert | null with potential severity boost)
  const filtered: Alert[] = [];
  for (const alert of rawAlerts) {
    const result = applyFilters({
      db,
      alert,
      maxRank: ctx.maxRank,
      cooldownMin: ctx.cooldownMin,
      minAbsFr: ctx.minAbsFr,
      currentTs: ctx.ts,
    });
    if (result) {
      filtered.push(result);
    }
  }

  // Sort by delta descending, take top N
  const sorted = filtered.sort((a, b) => b.delta - a.delta);
  const capped = sorted.slice(0, ctx.maxAlertsPerTick);

  logger.info(
    {
      symbolsChecked: ctx.symbols.length,
      rawAlerts: rawAlerts.length,
      ruleStats: stats,
      filtered: filtered.length,
      sent: capped.length,
    },
    "detection complete",
  );

  return capped;
}
