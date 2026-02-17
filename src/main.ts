import { loadConfig } from "./config.ts";
import { openDatabase } from "./db/connection.ts";
import { runMigrations } from "./db/migrations/index.ts";
import { deleteOldAlerts, deleteOldSnapshots, getAllSymbolsWithOi } from "./db/queries.ts";
import { fetchLorisData } from "./collector/client.ts";
import { storeSnapshot } from "./collector/store.ts";
import { runDetection } from "./detector/engine.ts";
import type { DetectorContext } from "./detector/types.ts";
import { enrichWithFunding } from "./enricher/funding.ts";
import { dispatchAlerts } from "./notifier/dispatcher.ts";
import { sendAdminNotification } from "./notifier/discord.ts";
import { createLogger } from "./lib/logger.ts";
import { createScheduler } from "./lib/scheduler.ts";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = openDatabase(config.DB_PATH, logger);

runMigrations(db, logger);

let consecutiveFailures = 0;

async function tick(): Promise<void> {
  const ts = new Date().toISOString();
  logger.info({ ts }, "tick start");

  // 1. Collect
  const data = await fetchLorisData(config.LORIS_API_URL, logger);
  if (!data) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) {
      await sendAdminNotification(
        config.DISCORD_ADMIN_WEBHOOK_URL,
        `API fetch failed ${consecutiveFailures} consecutive times`,
        logger,
      );
    }
    return;
  }
  consecutiveFailures = 0;

  // 2. Store
  storeSnapshot(db, data, ts, logger);

  // 3. Detect
  const symbols = getAllSymbolsWithOi(db, ts);
  const ctx: DetectorContext = {
    ts,
    symbols,
    rankDeltaWindowMin: config.RANK_DELTA_WINDOW_MIN,
    rankDeltaThreshold: config.RANK_DELTA_THRESHOLD,
    emaShortPeriod: config.EMA_SHORT_PERIOD,
    emaLongPeriod: config.EMA_LONG_PERIOD,
    maxRank: config.MAX_RANK,
    cooldownMin: config.COOLDOWN_MIN,
    minAbsFr: config.MIN_ABS_FR,
    maxAlertsPerTick: config.MAX_ALERTS_PER_TICK,
  };

  const alerts = runDetection(db, ctx, logger);

  // 4. Enrich
  const enriched = alerts.map((a) => enrichWithFunding(db, a));

  // 5. Notify
  if (enriched.length > 0) {
    const sent = await dispatchAlerts({
      db,
      alerts: enriched,
      webhookUrl: config.DISCORD_WEBHOOK_URL,
      ts,
      logger,
    });
    logger.info({ sent, total: enriched.length }, "alerts dispatched");
  }

  logger.info({ ts }, "tick complete");
}

// Daily retention cleanup
function runCleanup(): void {
  logger.info("running retention cleanup");
  deleteOldSnapshots(db, config.OI_RETENTION_DAYS, config.FR_RETENTION_DAYS);
  deleteOldAlerts(db, config.ALERT_RETENTION_DAYS);
}

// Run cleanup once at startup, then daily
runCleanup();
const cleanupInterval = setInterval(runCleanup, 24 * 60 * 60 * 1_000);

const scheduler = createScheduler({
  intervalMs: config.POLL_INTERVAL_MS,
  onTick: tick,
  logger,
});

scheduler.start();

// Graceful shutdown
function shutdown(): void {
  logger.info("shutting down...");
  scheduler.stop();
  clearInterval(cleanupInterval);
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
