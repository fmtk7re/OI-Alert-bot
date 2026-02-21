import type { Database } from "bun:sqlite";

// --- OI Snapshots ---

export type OiSnapshotRow = {
  readonly id: number;
  readonly ts: string;
  readonly symbol: string;
  readonly oi_rank: number;
  readonly created_at: string;
};

export function insertOiSnapshots(
  db: Database,
  rows: ReadonlyArray<{ readonly ts: string; readonly symbol: string; readonly oiRank: number }>,
): void {
  const stmt = db.prepare("INSERT INTO oi_snapshots (ts, symbol, oi_rank) VALUES (?, ?, ?)");
  const insertAll = db.transaction(() => {
    for (const row of rows) {
      stmt.run(row.ts, row.symbol, row.oiRank);
    }
  });
  insertAll();
}

export function getOiRankAt(
  db: Database,
  symbol: string,
  sinceTs: string,
): OiSnapshotRow | null {
  const row = db
    .query(
      "SELECT * FROM oi_snapshots WHERE symbol = ? AND ts <= ? ORDER BY ts DESC LIMIT 1",
    )
    .get(symbol, sinceTs);
  return (row as OiSnapshotRow) ?? null;
}

export function getLatestOiRank(db: Database, symbol: string): OiSnapshotRow | null {
  const row = db
    .query("SELECT * FROM oi_snapshots WHERE symbol = ? ORDER BY ts DESC LIMIT 1")
    .get(symbol);
  return (row as OiSnapshotRow) ?? null;
}

export function getOiHistory(
  db: Database,
  symbol: string,
  limit: number,
): ReadonlyArray<OiSnapshotRow> {
  return db
    .query("SELECT * FROM oi_snapshots WHERE symbol = ? ORDER BY ts DESC LIMIT ?")
    .all(symbol, limit) as OiSnapshotRow[];
}

// --- FR Snapshots ---

export type FrSnapshotRow = {
  readonly id: number;
  readonly ts: string;
  readonly symbol: string;
  readonly exchange: string;
  readonly rate: number;
  readonly created_at: string;
};

export function insertFrSnapshots(
  db: Database,
  rows: ReadonlyArray<{
    readonly ts: string;
    readonly symbol: string;
    readonly exchange: string;
    readonly rate: number;
  }>,
): void {
  const stmt = db.prepare(
    "INSERT INTO fr_snapshots (ts, symbol, exchange, rate) VALUES (?, ?, ?, ?)",
  );
  const insertAll = db.transaction(() => {
    for (const row of rows) {
      stmt.run(row.ts, row.symbol, row.exchange, row.rate);
    }
  });
  insertAll();
}

export function getLatestFrForSymbol(
  db: Database,
  symbol: string,
): ReadonlyArray<FrSnapshotRow> {
  const latestTs = db
    .query("SELECT ts FROM fr_snapshots WHERE symbol = ? ORDER BY ts DESC LIMIT 1")
    .get(symbol) as { ts: string } | null;
  if (!latestTs) return [];
  return db
    .query("SELECT * FROM fr_snapshots WHERE symbol = ? AND ts = ? ORDER BY rate DESC")
    .all(symbol, latestTs.ts) as FrSnapshotRow[];
}

// --- Alert History ---

export type AlertHistoryRow = {
  readonly id: number;
  readonly symbol: string;
  readonly rule: string;
  readonly severity: string;
  readonly sent_at: string;
};

export function insertAlertHistory(
  db: Database,
  row: {
    readonly symbol: string;
    readonly rule: string;
    readonly severity: string;
    readonly currentRank?: number;
  },
): void {
  db.run("INSERT INTO alert_history (symbol, rule, severity, current_rank) VALUES (?, ?, ?, ?)", [
    row.symbol,
    row.rule,
    row.severity,
    row.currentRank ?? null,
  ]);
}

export function getLastAlertCurrentRank(
  db: Database,
  symbol: string,
  rule: string,
): number | null {
  const row = db
    .query(
      "SELECT current_rank FROM alert_history WHERE symbol = ? AND rule = ? ORDER BY sent_at DESC LIMIT 1",
    )
    .get(symbol, rule) as { current_rank: number | null } | null;
  return row?.current_rank ?? null;
}

export function getLastAlertTime(db: Database, symbol: string, rule: string): string | null {
  const row = db
    .query(
      "SELECT sent_at FROM alert_history WHERE symbol = ? AND rule = ? ORDER BY sent_at DESC LIMIT 1",
    )
    .get(symbol, rule) as { sent_at: string } | null;
  return row?.sent_at ?? null;
}

// --- Retention cleanup ---

export function deleteOldSnapshots(db: Database, oiDays: number, frDays: number): void {
  db.run("DELETE FROM oi_snapshots WHERE created_at < datetime('now', ?)", [
    `-${oiDays} days`,
  ]);
  db.run("DELETE FROM fr_snapshots WHERE created_at < datetime('now', ?)", [
    `-${frDays} days`,
  ]);
}

export function deleteOldAlerts(db: Database, days: number): void {
  db.run("DELETE FROM alert_history WHERE sent_at < datetime('now', ?)", [`-${days} days`]);
}

/**
 * Get the previous OI rank (second-latest snapshot) for a symbol.
 * Skips the most recent snapshot and returns the one before it.
 */
export function getPreviousOiRank(db: Database, symbol: string): OiSnapshotRow | null {
  const rows = db
    .query("SELECT * FROM oi_snapshots WHERE symbol = ? ORDER BY ts DESC LIMIT 2")
    .all(symbol) as OiSnapshotRow[];
  return rows.length >= 2 ? rows[1]! : null;
}

// --- User Watchlists ---

export type WatchlistRow = {
  readonly id: number;
  readonly discord_user_id: string;
  readonly symbol: string;
  readonly created_at: string;
};

export function addWatchlistSymbol(db: Database, userId: string, symbol: string): boolean {
  try {
    db.run(
      "INSERT OR IGNORE INTO user_watchlists (discord_user_id, symbol) VALUES (?, ?)",
      [userId, symbol.toUpperCase()],
    );
    return true;
  } catch {
    return false;
  }
}

export function removeWatchlistSymbol(db: Database, userId: string, symbol: string): boolean {
  const result = db.run(
    "DELETE FROM user_watchlists WHERE discord_user_id = ? AND symbol = ?",
    [userId, symbol.toUpperCase()],
  );
  return result.changes > 0;
}

export function getWatchlistForUser(
  db: Database,
  userId: string,
): ReadonlyArray<WatchlistRow> {
  return db
    .query("SELECT * FROM user_watchlists WHERE discord_user_id = ? ORDER BY symbol")
    .all(userId) as WatchlistRow[];
}

export function getUsersWatchingSymbol(
  db: Database,
  symbol: string,
): ReadonlyArray<string> {
  const rows = db
    .query("SELECT DISTINCT discord_user_id FROM user_watchlists WHERE symbol = ?")
    .all(symbol.toUpperCase()) as Array<{ discord_user_id: string }>;
  return rows.map((r) => r.discord_user_id);
}

export function getAllWatchedSymbols(db: Database): ReadonlyArray<string> {
  const rows = db
    .query("SELECT DISTINCT symbol FROM user_watchlists ORDER BY symbol")
    .all() as Array<{ symbol: string }>;
  return rows.map((r) => r.symbol);
}

// --- User Settings ---

export type SummarySchedule = "daily" | "weekly" | "off";

export type UserSettingsRow = {
  readonly id: number;
  readonly discord_user_id: string;
  readonly max_rank: number;
  readonly min_severity: string;
  readonly cooldown_min: number;
  readonly summary_schedule: string;
  readonly created_at: string;
  readonly updated_at: string;
};

export function getUserSettings(db: Database, userId: string): UserSettingsRow | null {
  const row = db
    .query("SELECT * FROM user_settings WHERE discord_user_id = ?")
    .get(userId);
  return (row as UserSettingsRow) ?? null;
}

export function upsertUserSettings(
  db: Database,
  userId: string,
  settings: {
    readonly maxRank?: number;
    readonly minSeverity?: string;
    readonly cooldownMin?: number;
    readonly summarySchedule?: SummarySchedule;
  },
): void {
  const existing = getUserSettings(db, userId);
  if (existing) {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (settings.maxRank !== undefined) {
      updates.push("max_rank = ?");
      values.push(settings.maxRank);
    }
    if (settings.minSeverity !== undefined) {
      updates.push("min_severity = ?");
      values.push(settings.minSeverity);
    }
    if (settings.cooldownMin !== undefined) {
      updates.push("cooldown_min = ?");
      values.push(settings.cooldownMin);
    }
    if (settings.summarySchedule !== undefined) {
      updates.push("summary_schedule = ?");
      values.push(settings.summarySchedule);
    }
    if (updates.length === 0) return;
    updates.push("updated_at = datetime('now')");
    values.push(userId);
    db.run(
      `UPDATE user_settings SET ${updates.join(", ")} WHERE discord_user_id = ?`,
      values,
    );
  } else {
    db.run(
      `INSERT INTO user_settings (discord_user_id, max_rank, min_severity, cooldown_min, summary_schedule)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        settings.maxRank ?? 300,
        settings.minSeverity ?? "low",
        settings.cooldownMin ?? 120,
        settings.summarySchedule ?? "daily",
      ],
    );
  }
}

// --- Summary Log ---

export function getLastSummaryTime(db: Database, scope: string, period: string): string | null {
  const row = db
    .query("SELECT sent_at FROM summary_log WHERE scope = ? AND period = ? ORDER BY sent_at DESC LIMIT 1")
    .get(scope, period) as { sent_at: string } | null;
  return row?.sent_at ?? null;
}

export function insertSummaryLog(db: Database, scope: string, period: string): void {
  db.run("INSERT INTO summary_log (scope, period) VALUES (?, ?)", [scope, period]);
}

// --- Alert History (extended) ---

export function getRecentAlerts(
  db: Database,
  limit: number,
): ReadonlyArray<AlertHistoryRow> {
  return db
    .query("SELECT * FROM alert_history ORDER BY sent_at DESC LIMIT ?")
    .all(limit) as AlertHistoryRow[];
}

export function getAlertsBySymbol(
  db: Database,
  symbol: string,
  limit: number,
): ReadonlyArray<AlertHistoryRow> {
  return db
    .query("SELECT * FROM alert_history WHERE symbol = ? ORDER BY sent_at DESC LIMIT ?")
    .all(symbol, limit) as AlertHistoryRow[];
}

export function getAlertsSince(
  db: Database,
  sinceTs: string,
): ReadonlyArray<AlertHistoryRow> {
  return db
    .query("SELECT * FROM alert_history WHERE sent_at >= ? ORDER BY sent_at DESC")
    .all(sinceTs) as AlertHistoryRow[];
}

export function getAlertCountBySeverity(
  db: Database,
  sinceTs: string,
): ReadonlyArray<{ severity: string; count: number }> {
  return db
    .query(
      "SELECT severity, COUNT(*) as count FROM alert_history WHERE sent_at >= ? GROUP BY severity",
    )
    .all(sinceTs) as Array<{ severity: string; count: number }>;
}

export function getTopAlertedSymbols(
  db: Database,
  sinceTs: string,
  limit: number,
): ReadonlyArray<{ symbol: string; count: number }> {
  return db
    .query(
      "SELECT symbol, COUNT(*) as count FROM alert_history WHERE sent_at >= ? GROUP BY symbol ORDER BY count DESC LIMIT ?",
    )
    .all(sinceTs, limit) as Array<{ symbol: string; count: number }>;
}

// --- Utility ---

export function getAllSymbolsWithOi(db: Database, ts: string): ReadonlyArray<string> {
  const rows = db
    .query("SELECT DISTINCT symbol FROM oi_snapshots WHERE ts = ?")
    .all(ts) as Array<{ symbol: string }>;
  return rows.map((r) => r.symbol);
}

export function getSymbolCount(db: Database): number {
  const row = db
    .query("SELECT COUNT(DISTINCT symbol) as count FROM oi_snapshots")
    .get() as { count: number } | null;
  return row?.count ?? 0;
}

export function getSnapshotCount(db: Database): { oi: number; fr: number } {
  const oiRow = db.query("SELECT COUNT(*) as count FROM oi_snapshots").get() as { count: number };
  const frRow = db.query("SELECT COUNT(*) as count FROM fr_snapshots").get() as { count: number };
  return { oi: oiRow.count, fr: frRow.count };
}
