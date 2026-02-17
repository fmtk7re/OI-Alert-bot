import { Hono } from "hono";
import { serve } from "bun";
import type { Database } from "bun:sqlite";
import type pino from "pino";
import {
  getRecentAlerts,
  getAlertsBySymbol,
  getAlertCountBySeverity,
  getTopAlertedSymbols,
  getSymbolCount,
  getSnapshotCount,
  getLatestOiRank,
  getLatestFrForSymbol,
  getAllWatchedSymbols,
} from "../db/queries.ts";

export function createWebServer(opts: {
  readonly port: number;
  readonly db: Database;
  readonly logger: pino.Logger;
  readonly getStats: () => { tickCount: number; totalAlertsSent: number; startedAt: string };
}): { stop: () => void } {
  const { port, db, logger, getStats } = opts;
  const app = new Hono();

  // Health check
  app.get("/health", (c) => {
    const stats = getStats();
    return c.json({
      status: "ok",
      uptime: Date.now() - new Date(stats.startedAt).getTime(),
      tickCount: stats.tickCount,
      totalAlertsSent: stats.totalAlertsSent,
    });
  });

  // Dashboard stats
  app.get("/api/stats", (c) => {
    const stats = getStats();
    const sinceTs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const severityCounts = getAlertCountBySeverity(db, sinceTs);
    const topSymbols = getTopAlertedSymbols(db, sinceTs, 10);
    const symbolCount = getSymbolCount(db);
    const snapshots = getSnapshotCount(db);

    return c.json({
      uptime: Date.now() - new Date(stats.startedAt).getTime(),
      tickCount: stats.tickCount,
      totalAlertsSent: stats.totalAlertsSent,
      trackedSymbols: symbolCount,
      snapshots,
      last24h: {
        bySeverity: severityCounts,
        topSymbols,
      },
    });
  });

  // Recent alerts
  app.get("/api/alerts", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const symbol = c.req.query("symbol");

    const alerts = symbol
      ? getAlertsBySymbol(db, symbol.toUpperCase(), limit)
      : getRecentAlerts(db, limit);

    return c.json({ alerts, count: alerts.length });
  });

  // Symbol info
  app.get("/api/symbol/:symbol", (c) => {
    const symbol = c.req.param("symbol").toUpperCase();
    const oiRank = getLatestOiRank(db, symbol);
    const fundingRates = getLatestFrForSymbol(db, symbol);
    const alerts = getAlertsBySymbol(db, symbol, 20);

    return c.json({
      symbol,
      currentRank: oiRank?.oi_rank ?? null,
      lastSnapshot: oiRank?.ts ?? null,
      fundingRates: fundingRates.map((r) => ({ exchange: r.exchange, rate: r.rate })),
      recentAlerts: alerts,
    });
  });

  // Watched symbols
  app.get("/api/watchlist", (c) => {
    const symbols = getAllWatchedSymbols(db);
    return c.json({ symbols, count: symbols.length });
  });

  const server = serve({
    fetch: app.fetch,
    port,
  });

  logger.info({ port }, "web server started");

  return {
    stop(): void {
      server.stop();
      logger.info("web server stopped");
    },
  };
}
