import type { Database } from "bun:sqlite";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oi_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      symbol TEXT NOT NULL,
      oi_rank INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_oi_snapshots_symbol_ts ON oi_snapshots(symbol, ts);

    CREATE TABLE IF NOT EXISTS fr_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      symbol TEXT NOT NULL,
      exchange TEXT NOT NULL,
      rate REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_fr_snapshots_symbol_ts ON fr_snapshots(symbol, ts);

    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      rule TEXT NOT NULL,
      severity TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_alert_history_symbol_sent ON alert_history(symbol, sent_at);
  `);
}
