import type { Database } from "bun:sqlite";
import type pino from "pino";
import { insertAlertHistory } from "../db/queries.ts";
import type { EnrichedAlert } from "../enricher/funding.ts";
import { buildEmbed } from "../enricher/message.ts";
import { sendWebhook } from "./discord.ts";

export async function dispatchAlerts(opts: {
  readonly db: Database;
  readonly alerts: ReadonlyArray<EnrichedAlert>;
  readonly webhookUrl: string;
  readonly ts: string;
  readonly logger: pino.Logger;
}): Promise<number> {
  const { db, alerts, webhookUrl, ts, logger } = opts;
  let sentCount = 0;

  for (const alert of alerts) {
    const embed = buildEmbed(alert, ts);
    const ok = await sendWebhook(webhookUrl, { embeds: [embed] }, logger);
    if (ok) {
      insertAlertHistory(db, {
        symbol: alert.symbol,
        rule: alert.rule,
        severity: alert.severity,
      });
      sentCount++;
      logger.info({ symbol: alert.symbol, rule: alert.rule }, "alert sent");
    } else {
      logger.error({ symbol: alert.symbol, rule: alert.rule }, "alert send failed");
    }
  }

  return sentCount;
}
