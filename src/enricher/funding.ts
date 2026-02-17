import type { Database } from "bun:sqlite";
import { getLatestFrForSymbol, type FrSnapshotRow } from "../db/queries.ts";
import type { Alert } from "../detector/types.ts";

export type FrEntry = {
  readonly exchange: string;
  readonly rate: number;
};

export type EnrichedAlert = Alert & {
  readonly fundingRates: ReadonlyArray<FrEntry>;
  readonly maxSpread: {
    readonly highExchange: string;
    readonly lowExchange: string;
    readonly spread: number;
  } | null;
};

export function enrichWithFunding(db: Database, alert: Alert): EnrichedAlert {
  const rows: ReadonlyArray<FrSnapshotRow> = getLatestFrForSymbol(db, alert.symbol);

  const fundingRates: ReadonlyArray<FrEntry> = rows.map((r) => ({
    exchange: r.exchange,
    rate: r.rate,
  }));

  let maxSpread: EnrichedAlert["maxSpread"] = null;
  if (rows.length >= 2) {
    // rows are already sorted by rate DESC from the query
    const highest = rows[0]!;
    const lowest = rows[rows.length - 1]!;
    maxSpread = {
      highExchange: highest.exchange,
      lowExchange: lowest.exchange,
      spread: highest.rate - lowest.rate,
    };
  }

  return {
    ...alert,
    fundingRates,
    maxSpread,
  };
}
