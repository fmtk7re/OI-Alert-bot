import type { Database } from "bun:sqlite";

export function up(db: Database): void {
  db.exec(`
    ALTER TABLE alert_history ADD COLUMN current_rank INTEGER;
  `);
}
