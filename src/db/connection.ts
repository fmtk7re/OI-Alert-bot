import { Database } from "bun:sqlite";
import type pino from "pino";

export function openDatabase(dbPath: string, logger: pino.Logger): Database {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  logger.info({ dbPath }, "database opened");
  return db;
}
