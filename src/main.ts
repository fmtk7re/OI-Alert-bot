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

const startedAt = new Date().toISOString();
let tickCount = 0;
let totalAlertsSent = 0;
let consecutiveFailures = 0;

// Startup health check
logger.info(
  {
    version: "0.2.0",
    pollIntervalMs: config.POLL_INTERVAL_MS,
    maxRank: config.MAX_RANK,
    rules: ["rank-delta", "new-entry", "ema-cross"],
    dbPath: config.DB_PATH,
  },
  "OI Alert Bot starting",
);

void sendAdminNotification(
  config.DISCORD_ADMIN_WEBHOOK_URL,
  `Bot started at ${startedAt}\nRules: rank-delta, new-entry, ema-cross\nPoll: ${config.POLL_INTERVAL_MS / 1000}s`,
  logger,
);

async function tick(): Promise<void> {
  const tickStart = Date.now();
  const ts = new Date().toISOString();
  tickCount++;
  logger.info({ ts, tickNumber: tickCount }, "tick start");

  // 1. Collect
  const data = await fetchLorisData(config.LORIS_API_URL, logger);
  if (!data) {
    consecutiveFailures++;
    logger.warn({ consecutiveFailures }, "API fetch failed");
    if (consecutiveFailures >= 3) {
      await sendAdminNotification(
        config.DISCORD_ADMIN_WEBHOOK_URL,
        `API fetch failed ${consecutiveFailures} consecutive times`,
        logger,
      );
    }
    return;
  }
  if (consecutiveFailures > 0) {
    logger.info({ recoveredAfter: consecutiveFailures }, "API recovered");
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
    pollIntervalMs: config.POLL_INTERVAL_MS,
  };

  const alerts = runDetection(db, ctx, logger);

  // 4. Enrich
  const enriched = alerts.map((a) => enrichWithFunding(db, a));

  // 5. Notify
  let sent = 0;
  if (enriched.length > 0) {
    sent = await dispatchAlerts({
      db,
      alerts: enriched,
      webhookUrl: config.DISCORD_WEBHOOK_URL,
      ts,
      logger,
    });
    totalAlertsSent += sent;
    logger.info({ sent, total: enriched.length }, "alerts dispatched");
  }

  const tickDurationMs = Date.now() - tickStart;
  logger.info(
    {
      ts,
      tickNumber: tickCount,
      durationMs: tickDurationMs,
      symbols: symbols.length,
      alertsSent: sent,
      totalAlertsSent,
    },
    "tick complete",
  );
}

// Daily retention cleanup
function runCleanup(): void {
  logger.info("running retention cleanup");
  try {
    deleteOldSnapshots(db, config.OI_RETENTION_DAYS, config.FR_RETENTION_DAYS);
    deleteOldAlerts(db, config.ALERT_RETENTION_DAYS);
    logger.info("retention cleanup complete");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, "retention cleanup failed");
    void sendAdminNotification(
      config.DISCORD_ADMIN_WEBHOOK_URL,
      `Retention cleanup failed: ${message}`,
      logger,
    );
  }
}

// Periodic health check (every 6 hours)
function sendPeriodicHealthCheck(): void {
  const uptime = Date.now() - new Date(startedAt).getTime();
  const uptimeHours = Math.round(uptime / 3_600_000);
  void sendAdminNotification(
    config.DISCORD_ADMIN_WEBHOOK_URL,
    `Health check: uptime ${uptimeHours}h, ticks ${tickCount}, alerts sent ${totalAlertsSent}`,
    logger,
  );
}

// Run cleanup once at startup, then daily
runCleanup();
const cleanupInterval = setInterval(runCleanup, 24 * 60 * 60 * 1_000);
const healthCheckInterval = setInterval(sendPeriodicHealthCheck, 6 * 60 * 60 * 1_000);

const scheduler = createScheduler({
  intervalMs: config.POLL_INTERVAL_MS,
  onTick: tick,
  logger,
});

scheduler.start();

// Graceful shutdown
function shutdown(): void {
  logger.info({ tickCount, totalAlertsSent }, "shutting down...");
  scheduler.stop();
  clearInterval(cleanupInterval);
  clearInterval(healthCheckInterval);
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
