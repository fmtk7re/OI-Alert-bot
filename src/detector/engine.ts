import type { Database } from "bun:sqlite";
import type pino from "pino";
import { detectRankDelta } from "./rules/rank-delta.ts";
import { applyFilters } from "./filters.ts";
import type { Alert, DetectorContext } from "./types.ts";

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
    }
  }

  // Apply filters
  const filtered = rawAlerts.filter((alert) =>
    applyFilters({
      db,
      alert,
      maxRank: ctx.maxRank,
      cooldownMin: ctx.cooldownMin,
      minAbsFr: ctx.minAbsFr,
      currentTs: ctx.ts,
    }),
  );

  // Sort by delta descending, take top N
  const sorted = filtered.sort((a, b) => b.delta - a.delta);
  const capped = sorted.slice(0, ctx.maxAlertsPerTick);

  logger.info(
    {
      symbolsChecked: ctx.symbols.length,
      rawAlerts: rawAlerts.length,
      filtered: filtered.length,
      sent: capped.length,
    },
    "detection complete",
  );

  return capped;
}
