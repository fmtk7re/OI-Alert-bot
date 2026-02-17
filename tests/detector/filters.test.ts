import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { up } from "../../src/db/migrations/001_init.ts";
import { insertAlertHistory, insertFrSnapshots } from "../../src/db/queries.ts";
import {
  filterMaxRank,
  filterCooldown,
  filterFrBacking,
} from "../../src/detector/filters.ts";
import type { Alert } from "../../src/detector/types.ts";

function createTestDb(): Database {
  const db = new Database(":memory:");
  up(db);
  return db;
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    symbol: "BTCUSDT",
    rule: "rank-delta",
    severity: "medium",
    currentRank: 50,
    previousRank: 100,
    delta: 50,
    windowMinutes: 30,
    ...overrides,
  };
}

describe("filterMaxRank", () => {
  test("passes when currentRank <= maxRank", () => {
    expect(filterMaxRank(makeAlert({ currentRank: 100 }), 300)).toBe(true);
  });

  test("fails when currentRank > maxRank", () => {
    expect(filterMaxRank(makeAlert({ currentRank: 400 }), 300)).toBe(false);
  });

  test("passes when currentRank equals maxRank", () => {
    expect(filterMaxRank(makeAlert({ currentRank: 300 }), 300)).toBe(true);
  });
});

describe("filterCooldown", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("passes when no previous alert", () => {
    const result = filterCooldown(
      db,
      makeAlert(),
      120,
      "2024-01-01T03:00:00.000Z",
    );
    expect(result).toBe(true);
  });

  test("fails when within cooldown period", () => {
    insertAlertHistory(db, {
      symbol: "BTCUSDT",
      rule: "rank-delta",
      severity: "medium",
    });

    // Alert was just sent (sent_at defaults to now)
    // Using a current time very close to now
    const now = new Date();
    const result = filterCooldown(
      db,
      makeAlert(),
      120,
      now.toISOString(),
    );
    expect(result).toBe(false);
  });

  test("passes when outside cooldown period", () => {
    // Insert an old alert
    db.run(
      "INSERT INTO alert_history (symbol, rule, severity, sent_at) VALUES (?, ?, ?, ?)",
      ["BTCUSDT", "rank-delta", "medium", "2024-01-01T00:00:00.000Z"],
    );

    const result = filterCooldown(
      db,
      makeAlert(),
      120,
      "2024-01-01T03:00:00.000Z",
    );
    expect(result).toBe(true);
  });
});

describe("filterFrBacking", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("passes when FR >= minAbsFr exists", () => {
    insertFrSnapshots(db, [
      { ts: "2024-01-01T00:00:00.000Z", symbol: "BTCUSDT", exchange: "Binance", rate: 10.5 },
    ]);

    expect(filterFrBacking(db, makeAlert(), 5)).toBe(true);
  });

  test("passes with negative FR exceeding threshold", () => {
    insertFrSnapshots(db, [
      { ts: "2024-01-01T00:00:00.000Z", symbol: "BTCUSDT", exchange: "Binance", rate: -8.0 },
    ]);

    expect(filterFrBacking(db, makeAlert(), 5)).toBe(true);
  });

  test("fails when no FR meets threshold", () => {
    insertFrSnapshots(db, [
      { ts: "2024-01-01T00:00:00.000Z", symbol: "BTCUSDT", exchange: "Binance", rate: 2.0 },
    ]);

    expect(filterFrBacking(db, makeAlert(), 5)).toBe(false);
  });

  test("fails when no FR data exists", () => {
    expect(filterFrBacking(db, makeAlert(), 5)).toBe(false);
  });
});
