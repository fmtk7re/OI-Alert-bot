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
  row: { readonly symbol: string; readonly rule: string; readonly severity: string },
): void {
  db.run("INSERT INTO alert_history (symbol, rule, severity) VALUES (?, ?, ?)", [
    row.symbol,
    row.rule,
    row.severity,
  ]);
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

// --- Utility ---

export function getAllSymbolsWithOi(db: Database, ts: string): ReadonlyArray<string> {
  const rows = db
    .query("SELECT DISTINCT symbol FROM oi_snapshots WHERE ts = ?")
    .all(ts) as Array<{ symbol: string }>;
  return rows.map((r) => r.symbol);
}
