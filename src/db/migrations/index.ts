import type { Database } from "bun:sqlite";
import type pino from "pino";
import { up as init } from "./001_init.ts";
import { up as watchlists } from "./002_watchlists.ts";

const migrations: ReadonlyArray<{ readonly name: string; readonly up: (db: Database) => void }> = [
  { name: "001_init", up: init },
  { name: "002_watchlists", up: watchlists },
];

export function runMigrations(db: Database, logger: pino.Logger): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .query("SELECT name FROM migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    logger.info({ migration: migration.name }, "applying migration");
    db.transaction(() => {
      migration.up(db);
      db.run("INSERT INTO migrations (name) VALUES (?)", [migration.name]);
    })();
  }
}
