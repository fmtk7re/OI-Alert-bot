import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Database } from "bun:sqlite";
import {
  addWatchlistSymbol,
  removeWatchlistSymbol,
  getWatchlistForUser,
  getUserSettings,
  upsertUserSettings,
  getRecentAlerts,
  getAlertCountBySeverity,
  getTopAlertedSymbols,
  getSymbolCount,
  getSnapshotCount,
  type SummarySchedule,
} from "../db/queries.ts";

export const commands = [
  new SlashCommandBuilder()
    .setName("watch")
    .setDescription("Add a symbol to your watchlist")
    .addStringOption((opt) =>
      opt.setName("symbol").setDescription("Symbol to watch (e.g. BTCUSDT)").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("unwatch")
    .setDescription("Remove a symbol from your watchlist")
    .addStringOption((opt) =>
      opt.setName("symbol").setDescription("Symbol to remove").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("watchlist")
    .setDescription("Show your current watchlist"),
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure your alert preferences")
    .addIntegerOption((opt) =>
      opt.setName("max_rank").setDescription("Max rank threshold (1-500)").setMinValue(1).setMaxValue(500),
    )
    .addStringOption((opt) =>
      opt
        .setName("min_severity")
        .setDescription("Minimum severity to receive")
        .addChoices(
          { name: "Low (all alerts)", value: "low" },
          { name: "Medium", value: "medium" },
          { name: "High only", value: "high" },
        ),
    )
    .addIntegerOption((opt) =>
      opt.setName("cooldown").setDescription("Cooldown minutes (0-1440)").setMinValue(0).setMaxValue(1440),
    )
    .addStringOption((opt) =>
      opt
        .setName("summary")
        .setDescription("Summary schedule")
        .addChoices(
          { name: "Daily", value: "daily" },
          { name: "Weekly", value: "weekly" },
          { name: "Off", value: "off" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show bot status and recent alert statistics"),
].map((cmd) => cmd.toJSON());

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  db: Database,
  startedAt: string,
  tickCount: number,
  totalAlertsSent: number,
): Promise<void> {
  const userId = interaction.user.id;

  switch (interaction.commandName) {
    case "watch": {
      const symbol = interaction.options.getString("symbol", true).toUpperCase();
      const ok = addWatchlistSymbol(db, userId, symbol);
      if (ok) {
        await interaction.reply({ content: `Added **${symbol}** to your watchlist.`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Failed to add **${symbol}**.`, ephemeral: true });
      }
      break;
    }

    case "unwatch": {
      const symbol = interaction.options.getString("symbol", true).toUpperCase();
      const removed = removeWatchlistSymbol(db, userId, symbol);
      if (removed) {
        await interaction.reply({ content: `Removed **${symbol}** from your watchlist.`, ephemeral: true });
      } else {
        await interaction.reply({ content: `**${symbol}** was not in your watchlist.`, ephemeral: true });
      }
      break;
    }

    case "watchlist": {
      const items = getWatchlistForUser(db, userId);
      if (items.length === 0) {
        await interaction.reply({
          content: "Your watchlist is empty. Use `/watch` to add symbols.",
          ephemeral: true,
        });
      } else {
        const list = items.map((w) => `• ${w.symbol}`).join("\n");
        await interaction.reply({
          content: `**Your Watchlist** (${items.length} symbols):\n${list}`,
          ephemeral: true,
        });
      }
      break;
    }

    case "config": {
      const maxRank = interaction.options.getInteger("max_rank") ?? undefined;
      const minSeverity = interaction.options.getString("min_severity") ?? undefined;
      const cooldownMin = interaction.options.getInteger("cooldown") ?? undefined;
      const summarySchedule = (interaction.options.getString("summary") ?? undefined) as
        | SummarySchedule
        | undefined;

      const hasUpdates =
        maxRank !== undefined ||
        minSeverity !== undefined ||
        cooldownMin !== undefined ||
        summarySchedule !== undefined;

      if (hasUpdates) {
        upsertUserSettings(db, userId, { maxRank, minSeverity, cooldownMin, summarySchedule });
      }

      const settings = getUserSettings(db, userId);
      const display = settings
        ? [
            `Max Rank: **${settings.max_rank}**`,
            `Min Severity: **${settings.min_severity}**`,
            `Cooldown: **${settings.cooldown_min} min**`,
            `Summary: **${settings.summary_schedule}**`,
          ].join("\n")
        : "Using default settings. Provide options to customize.";

      await interaction.reply({
        content: hasUpdates
          ? `Settings updated!\n${display}`
          : `**Your Settings**\n${display}`,
        ephemeral: true,
      });
      break;
    }

    case "status": {
      const uptime = Date.now() - new Date(startedAt).getTime();
      const uptimeHours = Math.round(uptime / 3_600_000);
      const uptimeDays = Math.floor(uptimeHours / 24);
      const sinceTs = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const severityCounts = getAlertCountBySeverity(db, sinceTs);
      const topSymbols = getTopAlertedSymbols(db, sinceTs, 5);
      const recentAlerts = getRecentAlerts(db, 5);
      const symbolCount = getSymbolCount(db);
      const snapshots = getSnapshotCount(db);

      const severityLines = severityCounts.length > 0
        ? severityCounts.map((s) => `  ${s.severity}: ${s.count}`).join("\n")
        : "  None";

      const topLines = topSymbols.length > 0
        ? topSymbols.map((s) => `  ${s.symbol}: ${s.count} alerts`).join("\n")
        : "  None";

      const recentLines = recentAlerts.length > 0
        ? recentAlerts.map((a) => `  ${a.symbol} (${a.rule}, ${a.severity}) — ${a.sent_at}`).join("\n")
        : "  None";

      await interaction.reply({
        content: [
          "**OI Alert Bot Status**",
          `Uptime: ${uptimeDays}d ${uptimeHours % 24}h`,
          `Ticks: ${tickCount}`,
          `Total alerts sent: ${totalAlertsSent}`,
          `Tracked symbols: ${symbolCount}`,
          `Snapshots: ${snapshots.oi} OI, ${snapshots.fr} FR`,
          "",
          "**Last 24h alerts by severity:**",
          severityLines,
          "",
          "**Top alerted symbols (24h):**",
          topLines,
          "",
          "**Recent alerts:**",
          recentLines,
        ].join("\n"),
        ephemeral: true,
      });
      break;
    }
  }
}
