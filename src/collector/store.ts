import type { Database } from "bun:sqlite";
import type pino from "pino";
import { insertOiSnapshots, insertFrSnapshots } from "../db/queries.ts";
import type { LorisResponse } from "./schema.ts";

export function storeSnapshot(
  db: Database,
  data: LorisResponse,
  ts: string,
  logger: pino.Logger,
): void {
  const oiRows = Object.entries(data.oi_rankings).map(([symbol, oiRank]) => ({
    ts,
    symbol,
    oiRank,
  }));

  const frRows: Array<{
    readonly ts: string;
    readonly symbol: string;
    readonly exchange: string;
    readonly rate: number;
  }> = [];
  for (const [exchange, symbols] of Object.entries(data.funding_rates)) {
    for (const [symbol, rate] of Object.entries(symbols)) {
      frRows.push({ ts, symbol, exchange, rate });
    }
  }

  insertOiSnapshots(db, oiRows);
  insertFrSnapshots(db, frRows);

  logger.info(
    { oiCount: oiRows.length, frCount: frRows.length, ts },
    "snapshot stored",
  );
}
