import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { up } from "../../src/db/migrations/001_init.ts";
import { insertOiSnapshots } from "../../src/db/queries.ts";
import { detectRankDelta } from "../../src/detector/rules/rank-delta.ts";

function createTestDb(): Database {
  const db = new Database(":memory:");
  up(db);
  return db;
}

describe("detectRankDelta", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("detects rank improvement above threshold", () => {
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:35:00.000Z";

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "BTCUSDT", oiRank: 200 },
      { ts: currentTs, symbol: "BTCUSDT", oiRank: 150 },
    ]);

    const alert = detectRankDelta({
      db,
      symbol: "BTCUSDT",
      ts: currentTs,
      windowMin: 30,
      threshold: 30,
    });

    expect(alert).not.toBeNull();
    expect(alert?.delta).toBe(50);
    expect(alert?.severity).toBe("medium");
    expect(alert?.rule).toBe("rank-delta");
  });

  test("returns null when delta below threshold", () => {
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:35:00.000Z";

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "BTCUSDT", oiRank: 100 },
      { ts: currentTs, symbol: "BTCUSDT", oiRank: 90 },
    ]);

    const alert = detectRankDelta({
      db,
      symbol: "BTCUSDT",
      ts: currentTs,
      windowMin: 30,
      threshold: 30,
    });

    expect(alert).toBeNull();
  });

  test("classifies high severity for delta >= 100", () => {
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:35:00.000Z";

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "BTCUSDT", oiRank: 300 },
      { ts: currentTs, symbol: "BTCUSDT", oiRank: 150 },
    ]);

    const alert = detectRankDelta({
      db,
      symbol: "BTCUSDT",
      ts: currentTs,
      windowMin: 30,
      threshold: 30,
    });

    expect(alert).not.toBeNull();
    expect(alert?.severity).toBe("high");
    expect(alert?.delta).toBe(150);
  });

  test("classifies low severity for delta < 50", () => {
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:35:00.000Z";

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "BTCUSDT", oiRank: 100 },
      { ts: currentTs, symbol: "BTCUSDT", oiRank: 65 },
    ]);

    const alert = detectRankDelta({
      db,
      symbol: "BTCUSDT",
      ts: currentTs,
      windowMin: 30,
      threshold: 30,
    });

    expect(alert).not.toBeNull();
    expect(alert?.severity).toBe("low");
    expect(alert?.delta).toBe(35);
  });

  test("returns null when no previous data", () => {
    const currentTs = "2024-01-01T00:35:00.000Z";

    insertOiSnapshots(db, [
      { ts: currentTs, symbol: "BTCUSDT", oiRank: 50 },
    ]);

    const alert = detectRankDelta({
      db,
      symbol: "BTCUSDT",
      ts: currentTs,
      windowMin: 30,
      threshold: 30,
    });

    expect(alert).toBeNull();
  });

  test("returns null when rank worsened (increased)", () => {
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:35:00.000Z";

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "BTCUSDT", oiRank: 50 },
      { ts: currentTs, symbol: "BTCUSDT", oiRank: 100 },
    ]);

    const alert = detectRankDelta({
      db,
      symbol: "BTCUSDT",
      ts: currentTs,
      windowMin: 30,
      threshold: 30,
    });

    expect(alert).toBeNull();
  });
});
