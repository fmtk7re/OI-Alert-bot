import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { up as init } from "../../src/db/migrations/001_init.ts";
import { up as watchlists } from "../../src/db/migrations/002_watchlists.ts";
import {
  addWatchlistSymbol,
  removeWatchlistSymbol,
  getWatchlistForUser,
  getUsersWatchingSymbol,
  getAllWatchedSymbols,
  getUserSettings,
  upsertUserSettings,
  getLastSummaryTime,
  insertSummaryLog,
  getRecentAlerts,
  getAlertCountBySeverity,
  getTopAlertedSymbols,
  insertAlertHistory,
  getSymbolCount,
  getSnapshotCount,
  insertOiSnapshots,
} from "../../src/db/queries.ts";

function createTestDb(): Database {
  const db = new Database(":memory:");
  init(db);
  watchlists(db);
  return db;
}

describe("user watchlists", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("add symbol to watchlist", () => {
    const ok = addWatchlistSymbol(db, "user1", "BTCUSDT");
    expect(ok).toBe(true);

    const list = getWatchlistForUser(db, "user1");
    expect(list.length).toBe(1);
    expect(list[0]?.symbol).toBe("BTCUSDT");
  });

  test("add duplicate is idempotent", () => {
    addWatchlistSymbol(db, "user1", "BTCUSDT");
    addWatchlistSymbol(db, "user1", "BTCUSDT");

    const list = getWatchlistForUser(db, "user1");
    expect(list.length).toBe(1);
  });

  test("normalizes to uppercase", () => {
    addWatchlistSymbol(db, "user1", "btcusdt");

    const list = getWatchlistForUser(db, "user1");
    expect(list[0]?.symbol).toBe("BTCUSDT");
  });

  test("remove symbol from watchlist", () => {
    addWatchlistSymbol(db, "user1", "BTCUSDT");
    const removed = removeWatchlistSymbol(db, "user1", "BTCUSDT");
    expect(removed).toBe(true);

    const list = getWatchlistForUser(db, "user1");
    expect(list.length).toBe(0);
  });

  test("remove non-existent returns false", () => {
    const removed = removeWatchlistSymbol(db, "user1", "BTCUSDT");
    expect(removed).toBe(false);
  });

  test("get users watching symbol", () => {
    addWatchlistSymbol(db, "user1", "BTCUSDT");
    addWatchlistSymbol(db, "user2", "BTCUSDT");
    addWatchlistSymbol(db, "user3", "ETHUSDT");

    const users = getUsersWatchingSymbol(db, "BTCUSDT");
    expect(users.length).toBe(2);
    expect(users).toContain("user1");
    expect(users).toContain("user2");
  });

  test("get all watched symbols", () => {
    addWatchlistSymbol(db, "user1", "BTCUSDT");
    addWatchlistSymbol(db, "user1", "ETHUSDT");
    addWatchlistSymbol(db, "user2", "BTCUSDT");
    addWatchlistSymbol(db, "user2", "SOLUSDT");

    const symbols = getAllWatchedSymbols(db);
    expect(symbols.length).toBe(3);
    expect(symbols).toContain("BTCUSDT");
    expect(symbols).toContain("ETHUSDT");
    expect(symbols).toContain("SOLUSDT");
  });

  test("empty watchlist", () => {
    const list = getWatchlistForUser(db, "user1");
    expect(list.length).toBe(0);
  });
});

describe("user settings", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("returns null for new user", () => {
    const settings = getUserSettings(db, "user1");
    expect(settings).toBeNull();
  });

  test("create default settings", () => {
    upsertUserSettings(db, "user1", {});

    const settings = getUserSettings(db, "user1");
    expect(settings).not.toBeNull();
    expect(settings?.max_rank).toBe(300);
    expect(settings?.min_severity).toBe("low");
    expect(settings?.cooldown_min).toBe(120);
    expect(settings?.summary_schedule).toBe("daily");
  });

  test("update specific settings", () => {
    upsertUserSettings(db, "user1", {});
    upsertUserSettings(db, "user1", { maxRank: 100, minSeverity: "high" });

    const settings = getUserSettings(db, "user1");
    expect(settings?.max_rank).toBe(100);
    expect(settings?.min_severity).toBe("high");
    expect(settings?.cooldown_min).toBe(120); // unchanged
  });

  test("create with custom values", () => {
    upsertUserSettings(db, "user1", {
      maxRank: 50,
      minSeverity: "medium",
      cooldownMin: 60,
      summarySchedule: "weekly",
    });

    const settings = getUserSettings(db, "user1");
    expect(settings?.max_rank).toBe(50);
    expect(settings?.min_severity).toBe("medium");
    expect(settings?.cooldown_min).toBe(60);
    expect(settings?.summary_schedule).toBe("weekly");
  });
});

describe("summary log", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("returns null when no summary sent", () => {
    expect(getLastSummaryTime(db, "global", "daily")).toBeNull();
  });

  test("tracks summary send time", () => {
    insertSummaryLog(db, "global", "daily");

    const time = getLastSummaryTime(db, "global", "daily");
    expect(time).not.toBeNull();
  });

  test("separate tracking for daily and weekly", () => {
    insertSummaryLog(db, "global", "daily");

    expect(getLastSummaryTime(db, "global", "daily")).not.toBeNull();
    expect(getLastSummaryTime(db, "global", "weekly")).toBeNull();
  });
});

describe("alert history (extended)", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("get recent alerts", () => {
    insertAlertHistory(db, { symbol: "BTCUSDT", rule: "rank-delta", severity: "high" });
    insertAlertHistory(db, { symbol: "ETHUSDT", rule: "new-entry", severity: "medium" });

    const alerts = getRecentAlerts(db, 10);
    expect(alerts.length).toBe(2);
  });

  test("get alert count by severity", () => {
    insertAlertHistory(db, { symbol: "BTCUSDT", rule: "rank-delta", severity: "high" });
    insertAlertHistory(db, { symbol: "ETHUSDT", rule: "rank-delta", severity: "high" });
    insertAlertHistory(db, { symbol: "SOLUSDT", rule: "new-entry", severity: "medium" });

    // Use a date well in the past to catch all alerts (SQLite datetime format)
    const sinceTs = "2000-01-01 00:00:00";
    const counts = getAlertCountBySeverity(db, sinceTs);

    const highCount = counts.find((c) => c.severity === "high");
    expect(highCount?.count).toBe(2);
  });

  test("get top alerted symbols", () => {
    insertAlertHistory(db, { symbol: "BTCUSDT", rule: "rank-delta", severity: "high" });
    insertAlertHistory(db, { symbol: "BTCUSDT", rule: "new-entry", severity: "high" });
    insertAlertHistory(db, { symbol: "ETHUSDT", rule: "rank-delta", severity: "medium" });

    const sinceTs = "2000-01-01 00:00:00";
    const top = getTopAlertedSymbols(db, sinceTs, 5);

    expect(top[0]?.symbol).toBe("BTCUSDT");
    expect(top[0]?.count).toBe(2);
  });
});

describe("utility queries", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("get symbol count", () => {
    insertOiSnapshots(db, [
      { ts: "2024-01-01T00:00:00.000Z", symbol: "BTCUSDT", oiRank: 1 },
      { ts: "2024-01-01T00:00:00.000Z", symbol: "ETHUSDT", oiRank: 2 },
    ]);

    expect(getSymbolCount(db)).toBe(2);
  });

  test("get snapshot count", () => {
    insertOiSnapshots(db, [
      { ts: "2024-01-01T00:00:00.000Z", symbol: "BTCUSDT", oiRank: 1 },
    ]);

    const counts = getSnapshotCount(db);
    expect(counts.oi).toBe(1);
    expect(counts.fr).toBe(0);
  });
});
