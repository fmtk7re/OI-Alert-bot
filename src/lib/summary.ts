import type { Database } from "bun:sqlite";
import type pino from "pino";
import {
  getAlertsSince,
  getAlertCountBySeverity,
  getTopAlertedSymbols,
  getLastSummaryTime,
  insertSummaryLog,
} from "../db/queries.ts";
import { sendWebhook } from "../notifier/discord.ts";

type SummaryPeriod = "daily" | "weekly";

function getPeriodSinceTs(period: SummaryPeriod): string {
  const now = Date.now();
  const ms = period === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

function shouldSendSummary(
  db: Database,
  period: SummaryPeriod,
  dailyHourUtc: number,
  weeklyDay: number,
): boolean {
  const now = new Date();

  if (period === "daily") {
    if (now.getUTCHours() !== dailyHourUtc) return false;
  } else {
    if (now.getUTCDay() !== weeklyDay || now.getUTCHours() !== dailyHourUtc) return false;
  }

  // Check if already sent this period
  const lastSent = getLastSummaryTime(db, "global", period);
  if (lastSent) {
    const lastTime = new Date(lastSent).getTime();
    const minInterval = period === "daily" ? 23 * 60 * 60 * 1000 : 6 * 24 * 60 * 60 * 1000;
    if (now.getTime() - lastTime < minInterval) return false;
  }

  return true;
}

function buildSummaryEmbed(
  period: SummaryPeriod,
  sinceTs: string,
  db: Database,
): Record<string, unknown> {
  const alerts = getAlertsSince(db, sinceTs);
  const severityCounts = getAlertCountBySeverity(db, sinceTs);
  const topSymbols = getTopAlertedSymbols(db, sinceTs, 10);

  const periodLabel = period === "daily" ? "Daily" : "Weekly";
  const color = period === "daily" ? 0x5865f2 : 0x57f287;

  const severityLines = severityCounts.length > 0
    ? severityCounts.map((s) => `${s.severity}: **${s.count}**`).join(" | ")
    : "No alerts";

  const topLines = topSymbols.length > 0
    ? topSymbols.map((s, i) => `${i + 1}. **${s.symbol}** — ${s.count} alerts`).join("\n")
    : "No alerts";

  return {
    title: `${periodLabel} Summary`,
    color,
    fields: [
      {
        name: "Total Alerts",
        value: `${alerts.length}`,
        inline: true,
      },
      {
        name: "By Severity",
        value: severityLines,
        inline: true,
      },
      {
        name: `Top Symbols (${periodLabel})`,
        value: topLines,
      },
    ],
    footer: {
      text: `Period: ${sinceTs.slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function checkAndSendSummary(opts: {
  readonly db: Database;
  readonly webhookUrl: string;
  readonly dailyHourUtc: number;
  readonly weeklyDay: number;
  readonly logger: pino.Logger;
}): Promise<void> {
  const { db, webhookUrl, dailyHourUtc, weeklyDay, logger } = opts;

  for (const period of ["daily", "weekly"] as const) {
    if (!shouldSendSummary(db, period, dailyHourUtc, weeklyDay)) continue;

    const sinceTs = getPeriodSinceTs(period);
    const embed = buildSummaryEmbed(period, sinceTs, db);

    const ok = await sendWebhook(webhookUrl, { embeds: [embed] }, logger);
    if (ok) {
      insertSummaryLog(db, "global", period);
      logger.info({ period }, "summary sent");
    } else {
      logger.error({ period }, "summary send failed");
    }
  }
}
