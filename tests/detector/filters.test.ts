import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { up } from "../../src/db/migrations/001_init.ts";
import { up as alertCurrentRank } from "../../src/db/migrations/003_alert_current_rank.ts";
import { insertAlertHistory, insertFrSnapshots } from "../../src/db/queries.ts";
import {
  filterMaxRank,
  filterCooldown,
  filterDuplicateContent,
  filterFrBacking,
  countFrBackingExchanges,
  boostSeverity,
  applyFilters,
} from "../../src/detector/filters.ts";
import type { Alert } from "../../src/detector/types.ts";

function createTestDb(): Database {
  const db = new Database(":memory:");
  up(db);
  alertCurrentRank(db);
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

  test("high severity gets halved cooldown", () => {
    // Alert sent 70 min ago. Normal cooldown is 120 min (should fail),
    // but high severity gets 60 min cooldown (should pass).
    db.run(
      "INSERT INTO alert_history (symbol, rule, severity, sent_at) VALUES (?, ?, ?, ?)",
      ["BTCUSDT", "rank-delta", "high", "2024-01-01T00:00:00.000Z"],
    );

    const result = filterCooldown(
      db,
      makeAlert({ severity: "high" }),
      120,
      "2024-01-01T01:10:00.000Z", // 70 min later
    );
    expect(result).toBe(true);
  });

  test("medium severity uses full cooldown", () => {
    db.run(
      "INSERT INTO alert_history (symbol, rule, severity, sent_at) VALUES (?, ?, ?, ?)",
      ["BTCUSDT", "rank-delta", "medium", "2024-01-01T00:00:00.000Z"],
    );

    const result = filterCooldown(
      db,
      makeAlert({ severity: "medium" }),
      120,
      "2024-01-01T01:10:00.000Z", // 70 min later — within 120 min
    );
    expect(result).toBe(false);
  });
});

describe("filterDuplicateContent", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("passes when no previous alert exists", () => {
    expect(filterDuplicateContent(db, makeAlert({ currentRank: 50 }))).toBe(true);
  });

  test("suppresses when currentRank matches last alert", () => {
    insertAlertHistory(db, {
      symbol: "BTCUSDT",
      rule: "rank-delta",
      severity: "medium",
      currentRank: 50,
    });

    expect(filterDuplicateContent(db, makeAlert({ currentRank: 50 }))).toBe(false);
  });

  test("passes when currentRank differs from last alert", () => {
    insertAlertHistory(db, {
      symbol: "BTCUSDT",
      rule: "rank-delta",
      severity: "medium",
      currentRank: 50,
    });

    expect(filterDuplicateContent(db, makeAlert({ currentRank: 40 }))).toBe(true);
  });

  test("passes when last alert has no stored rank (legacy row)", () => {
    db.run(
      "INSERT INTO alert_history (symbol, rule, severity, sent_at) VALUES (?, ?, ?, ?)",
      ["BTCUSDT", "rank-delta", "medium", "2024-01-01T00:00:00.000Z"],
    );

    expect(filterDuplicateContent(db, makeAlert({ currentRank: 50 }))).toBe(true);
  });

  test("only compares within same symbol and rule", () => {
    insertAlertHistory(db, {
      symbol: "ETHUSDT",
      rule: "rank-delta",
      severity: "medium",
      currentRank: 50,
    });

    // Different symbol — should not be suppressed
    expect(filterDuplicateContent(db, makeAlert({ symbol: "BTCUSDT", currentRank: 50 }))).toBe(true);
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

describe("countFrBackingExchanges", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("counts exchanges meeting threshold", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    insertFrSnapshots(db, [
      { ts, symbol: "BTCUSDT", exchange: "Binance", rate: 10.5 },
      { ts, symbol: "BTCUSDT", exchange: "Bybit", rate: 8.0 },
      { ts, symbol: "BTCUSDT", exchange: "OKX", rate: 3.0 },
      { ts, symbol: "BTCUSDT", exchange: "Hyperliquid", rate: -7.0 },
    ]);

    expect(countFrBackingExchanges(db, "BTCUSDT", 5)).toBe(3);
  });

  test("returns 0 when no exchanges meet threshold", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    insertFrSnapshots(db, [
      { ts, symbol: "BTCUSDT", exchange: "Binance", rate: 2.0 },
    ]);

    expect(countFrBackingExchanges(db, "BTCUSDT", 5)).toBe(0);
  });
});

describe("boostSeverity", () => {
  test("no boost with fewer than 3 exchanges", () => {
    expect(boostSeverity("low", 2)).toBe("low");
    expect(boostSeverity("medium", 1)).toBe("medium");
    expect(boostSeverity("high", 0)).toBe("high");
  });

  test("boosts low to medium with 3+ exchanges", () => {
    expect(boostSeverity("low", 3)).toBe("medium");
    expect(boostSeverity("low", 5)).toBe("medium");
  });

  test("boosts medium to high with 3+ exchanges", () => {
    expect(boostSeverity("medium", 3)).toBe("high");
    expect(boostSeverity("medium", 4)).toBe("high");
  });

  test("high stays high even with 3+ exchanges", () => {
    expect(boostSeverity("high", 3)).toBe("high");
    expect(boostSeverity("high", 10)).toBe("high");
  });
});

describe("applyFilters (integration)", () => {
  let db: Database;

  beforeEach(() => {
    db = createTestDb();
  });

  test("returns alert when all filters pass", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    insertFrSnapshots(db, [
      { ts, symbol: "BTCUSDT", exchange: "Binance", rate: 10.0 },
    ]);

    const result = applyFilters({
      db,
      alert: makeAlert({ currentRank: 50 }),
      maxRank: 300,
      cooldownMin: 120,
      minAbsFr: 5,
      currentTs: ts,
    });

    expect(result).not.toBeNull();
    expect(result?.symbol).toBe("BTCUSDT");
  });

  test("returns null when maxRank filter fails", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    insertFrSnapshots(db, [
      { ts, symbol: "BTCUSDT", exchange: "Binance", rate: 10.0 },
    ]);

    const result = applyFilters({
      db,
      alert: makeAlert({ currentRank: 400 }),
      maxRank: 300,
      cooldownMin: 120,
      minAbsFr: 5,
      currentTs: ts,
    });

    expect(result).toBeNull();
  });

  test("boosts severity when 3+ FR exchanges back it", () => {
    const ts = "2024-01-01T00:00:00.000Z";
    insertFrSnapshots(db, [
      { ts, symbol: "BTCUSDT", exchange: "Binance", rate: 10.0 },
      { ts, symbol: "BTCUSDT", exchange: "Bybit", rate: 8.0 },
      { ts, symbol: "BTCUSDT", exchange: "OKX", rate: 7.0 },
      { ts, symbol: "BTCUSDT", exchange: "Hyperliquid", rate: 6.0 },
    ]);

    const result = applyFilters({
      db,
      alert: makeAlert({ currentRank: 50, severity: "low" }),
      maxRank: 300,
      cooldownMin: 120,
      minAbsFr: 5,
      currentTs: ts,
    });

    expect(result).not.toBeNull();
    expect(result?.severity).toBe("medium"); // boosted from low
  });
});
