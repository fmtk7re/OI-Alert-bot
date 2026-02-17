import type { Database } from "bun:sqlite";

export function up(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(discord_user_id, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlists_user ON user_watchlists(discord_user_id);
    CREATE INDEX IF NOT EXISTS idx_watchlists_symbol ON user_watchlists(symbol);

    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL UNIQUE,
      max_rank INTEGER NOT NULL DEFAULT 300,
      min_severity TEXT NOT NULL DEFAULT 'low',
      cooldown_min INTEGER NOT NULL DEFAULT 120,
      summary_schedule TEXT NOT NULL DEFAULT 'daily',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_settings_user ON user_settings(discord_user_id);

    CREATE TABLE IF NOT EXISTS summary_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      period TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
