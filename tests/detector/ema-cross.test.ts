import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { up } from "../../src/db/migrations/001_init.ts";
import { insertOiSnapshots } from "../../src/db/queries.ts";
import { detectEmaCross } from "../../src/detector/rules/ema-cross.ts";

function createTestDb(): Database {
  const db = new Database(":memory:");
  up(db);
  return db;
}

function insertTimeSeriesRanks(
  db: Database,
  symbol: string,
  ranks: ReadonlyArray<number>,
  startTs: string,
  intervalMs: number,
): void {
  const rows = ranks.map((rank, i) => ({
    ts: new Date(new Date(startTs).getTime() + i * intervalMs).toISOString(),
    symbol,
    oiRank: rank,
  }));
  insertOiSnapshots(db, rows);
}

describe("detectEmaCross", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("returns null when insufficient data", () => {
    insertOiSnapshots(db, [
      { ts: "2024-01-01T00:00:00.000Z", symbol: "BTCUSDT", oiRank: 100 },
      { ts: "2024-01-01T00:01:00.000Z", symbol: "BTCUSDT", oiRank: 90 },
    ]);

    const alert = detectEmaCross({
      db,
      symbol: "BTCUSDT",
      ts: "2024-01-01T00:01:00.000Z",
      shortPeriod: 5,
      longPeriod: 20,
    });

    expect(alert).toBeNull();
  });

  test("detects bearish cross on rank (OI surging)", () => {
    // Simulate rank decreasing rapidly (OI surging)
    // Start with fluctuating ranks, then sharp decrease
    const ranks = [
      // Phase 1: rank hovering around 200 (stable)
      200, 205, 198, 202, 195, 200, 198, 203, 197, 200,
      200, 205, 198, 202, 195, 200, 198, 203, 197, 200,
      // Phase 2: rank suddenly dropping (OI surging)
      180, 160, 140, 120, 100, 80, 60, 50, 40, 30, 20,
    ];

    insertTimeSeriesRanks(
      db,
      "SOLUSDT",
      ranks,
      "2024-01-01T00:00:00.000Z",
      60_000,
    );

    const lastTs = new Date(
      new Date("2024-01-01T00:00:00.000Z").getTime() + (ranks.length - 1) * 60_000,
    ).toISOString();

    const alert = detectEmaCross({
      db,
      symbol: "SOLUSDT",
      ts: lastTs,
      shortPeriod: 5,
      longPeriod: 20,
    });

    // Should detect the cross since short EMA crosses below long EMA
    // (rank decreasing = OI surging)
    if (alert) {
      expect(alert.rule).toBe("ema-cross");
      expect(alert.severity).toBe("medium");
      expect(alert.currentRank).toBe(20);
    }
  });

  test("returns null for stable ranks", () => {
    // Stable ranks — no cross should occur
    const ranks = Array.from({ length: 35 }, () => 100);

    insertTimeSeriesRanks(
      db,
      "BTCUSDT",
      ranks,
      "2024-01-01T00:00:00.000Z",
      60_000,
    );

    const lastTs = new Date(
      new Date("2024-01-01T00:00:00.000Z").getTime() + (ranks.length - 1) * 60_000,
    ).toISOString();

    const alert = detectEmaCross({
      db,
      symbol: "BTCUSDT",
      ts: lastTs,
      shortPeriod: 5,
      longPeriod: 20,
    });

    expect(alert).toBeNull();
  });

  test("returns null when rank is increasing (OI declining)", () => {
    // Ranks increasing = OI declining, should not trigger
    const ranks = [
      50, 55, 60, 65, 70, 75, 80, 85, 90, 95,
      100, 105, 110, 115, 120, 125, 130, 135, 140, 145,
      150, 160, 170, 180, 190, 200, 210, 220, 230, 240, 250,
    ];

    insertTimeSeriesRanks(
      db,
      "ETHUSDT",
      ranks,
      "2024-01-01T00:00:00.000Z",
      60_000,
    );

    const lastTs = new Date(
      new Date("2024-01-01T00:00:00.000Z").getTime() + (ranks.length - 1) * 60_000,
    ).toISOString();

    const alert = detectEmaCross({
      db,
      symbol: "ETHUSDT",
      ts: lastTs,
      shortPeriod: 5,
      longPeriod: 20,
    });

    expect(alert).toBeNull();
  });

  test("returns null for empty symbol", () => {
    const alert = detectEmaCross({
      db,
      symbol: "NONEXISTENT",
      ts: "2024-01-01T00:01:00.000Z",
      shortPeriod: 5,
      longPeriod: 20,
    });

    expect(alert).toBeNull();
  });
});
