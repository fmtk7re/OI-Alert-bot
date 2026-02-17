import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { up } from "../../src/db/migrations/001_init.ts";
import { insertOiSnapshots } from "../../src/db/queries.ts";
import { detectNewEntry } from "../../src/detector/rules/new-entry.ts";

function createTestDb(): Database {
  const db = new Database(":memory:");
  up(db);
  return db;
}

const POLL_INTERVAL_MS = 60_000;

describe("detectNewEntry", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("detects 500+ to ranked transition", () => {
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:01:00.000Z";

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "NEWCOIN", oiRank: 501 },
      { ts: currentTs, symbol: "NEWCOIN", oiRank: 250 },
    ]);

    const alert = detectNewEntry({
      db,
      symbol: "NEWCOIN",
      ts: currentTs,
      pollIntervalMs: POLL_INTERVAL_MS,
    });

    expect(alert).not.toBeNull();
    expect(alert?.rule).toBe("new-entry");
    expect(alert?.severity).toBe("high");
    expect(alert?.currentRank).toBe(250);
    expect(alert?.previousRank).toBe(501);
    expect(alert?.delta).toBe(251);
  });

  test("returns null when previous rank was not 501", () => {
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:01:00.000Z";

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "BTCUSDT", oiRank: 100 },
      { ts: currentTs, symbol: "BTCUSDT", oiRank: 50 },
    ]);

    const alert = detectNewEntry({
      db,
      symbol: "BTCUSDT",
      ts: currentTs,
      pollIntervalMs: POLL_INTERVAL_MS,
    });

    expect(alert).toBeNull();
  });

  test("returns null when current rank is still 500+", () => {
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:01:00.000Z";

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "NEWCOIN", oiRank: 501 },
      { ts: currentTs, symbol: "NEWCOIN", oiRank: 501 },
    ]);

    const alert = detectNewEntry({
      db,
      symbol: "NEWCOIN",
      ts: currentTs,
      pollIntervalMs: POLL_INTERVAL_MS,
    });

    expect(alert).toBeNull();
  });

  test("detects new entry when no previous data exists", () => {
    const currentTs = "2024-01-01T00:01:00.000Z";

    insertOiSnapshots(db, [
      { ts: currentTs, symbol: "BRANDNEW", oiRank: 300 },
    ]);

    const alert = detectNewEntry({
      db,
      symbol: "BRANDNEW",
      ts: currentTs,
      pollIntervalMs: POLL_INTERVAL_MS,
    });

    expect(alert).not.toBeNull();
    expect(alert?.rule).toBe("new-entry");
    expect(alert?.severity).toBe("high");
    expect(alert?.previousRank).toBe(501);
  });

  test("returns null when no current data", () => {
    const alert = detectNewEntry({
      db,
      symbol: "NONEXISTENT",
      ts: "2024-01-01T00:01:00.000Z",
      pollIntervalMs: POLL_INTERVAL_MS,
    });

    expect(alert).toBeNull();
  });

  test("uses correct lookback window based on poll interval", () => {
    // Past data that's within 2x poll interval should be found
    const pastTs = "2024-01-01T00:00:00.000Z";
    const currentTs = "2024-01-01T00:01:30.000Z"; // 90s later

    insertOiSnapshots(db, [
      { ts: pastTs, symbol: "NEWCOIN", oiRank: 501 },
      { ts: currentTs, symbol: "NEWCOIN", oiRank: 200 },
    ]);

    const alert = detectNewEntry({
      db,
      symbol: "NEWCOIN",
      ts: currentTs,
      pollIntervalMs: POLL_INTERVAL_MS,
    });

    expect(alert).not.toBeNull();
  });
});
