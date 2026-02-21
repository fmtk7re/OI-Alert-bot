import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
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
import {
  TUNABLE_KEYS,
  type TunableKey,
  getEffectiveValue,
  setRuntimeValue,
  getTunableDisplay,
} from "../lib/runtime-config.ts";

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
  new SlashCommandBuilder()
    .setName("threshold")
    .setDescription("Change global detection thresholds (admin)")
    .addIntegerOption((opt) =>
      opt.setName("rank_delta").setDescription("OI ランク変動しきい値 (default: 30)").setMinValue(1).setMaxValue(500),
    )
    .addIntegerOption((opt) =>
      opt.setName("window").setDescription("比較ウィンドウ 分 (default: 10)").setMinValue(1).setMaxValue(120),
    )
    .addNumberOption((opt) =>
      opt.setName("min_fr").setDescription("FR バッキング閾値 (default: 5)").setMinValue(0),
    )
    .addIntegerOption((opt) =>
      opt.setName("max_alerts").setDescription("1tick 最大通知数 (default: 10)").setMinValue(1).setMaxValue(50),
    )
    .addIntegerOption((opt) =>
      opt.setName("ema_short").setDescription("EMA 短期 (default: 5)").setMinValue(1).setMaxValue(100),
    )
    .addIntegerOption((opt) =>
      opt.setName("ema_long").setDescription("EMA 長期 (default: 20)").setMinValue(2).setMaxValue(200),
    ),
  new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Show all current bot settings (global + personal)"),
  new SlashCommandBuilder()
    .setName("reset-threshold")
    .setDescription("Reset a threshold to its env default")
    .addStringOption((opt) =>
      opt
        .setName("key")
        .setDescription("Which threshold to reset")
        .setRequired(true)
        .addChoices(
          { name: "ランク変動しきい値", value: "rank_delta_threshold" },
          { name: "比較ウィンドウ", value: "rank_delta_window_min" },
          { name: "FR バッキング閾値", value: "min_abs_fr" },
          { name: "1tick 最大通知数", value: "max_alerts_per_tick" },
          { name: "EMA 短期", value: "ema_short_period" },
          { name: "EMA 長期", value: "ema_long_period" },
          { name: "すべてリセット", value: "all" },
        ),
    ),
].map((cmd) => cmd.toJSON());

/** Map /threshold option names → tunable keys */
const OPTION_TO_KEY: ReadonlyArray<{ option: string; key: TunableKey }> = [
  { option: "rank_delta", key: "rank_delta_threshold" },
  { option: "window", key: "rank_delta_window_min" },
  { option: "min_fr", key: "min_abs_fr" },
  { option: "max_alerts", key: "max_alerts_per_tick" },
  { option: "ema_short", key: "ema_short_period" },
  { option: "ema_long", key: "ema_long_period" },
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  db: Database,
  envConfig: Config,
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

    case "threshold": {
      const changes: string[] = [];

      for (const { option, key } of OPTION_TO_KEY) {
        const val = key === "min_abs_fr"
          ? interaction.options.getNumber(option)
          : interaction.options.getInteger(option);
        if (val !== null) {
          const prev = getEffectiveValue(db, envConfig, key);
          setRuntimeValue(db, key, val);
          const meta = TUNABLE_KEYS[key];
          changes.push(`${meta.label}: ${prev}${meta.unit} → **${val}${meta.unit}**`);
        }
      }

      if (changes.length === 0) {
        // No options — show current thresholds
        const display = getTunableDisplay(db, envConfig);
        const lines = display.map((d) => {
          const src = d.source === "override" ? " *(変更済み)*" : "";
          return `${d.label}: **${d.value}${d.unit}**${src}`;
        });
        await interaction.reply({
          content: `**Detection Thresholds**\n${lines.join("\n")}\n\nUse options to change. \`/reset-threshold\` to revert.`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `**Thresholds updated (next tick から反映)**\n${changes.join("\n")}`,
          ephemeral: true,
        });
      }
      break;
    }

    case "settings": {
      // Global thresholds
      const tunables = getTunableDisplay(db, envConfig);
      const globalLines = tunables.map((d) => {
        const src = d.source === "override" ? " *(変更済み)*" : " *(default)*";
        return `  ${d.label}: **${d.value}${d.unit}**${src}`;
      });

      // Personal settings
      const settings = getUserSettings(db, userId);
      const personalLines = settings
        ? [
            `  Max Rank: **${settings.max_rank}**`,
            `  Min Severity: **${settings.min_severity}**`,
            `  Cooldown: **${settings.cooldown_min} min**`,
            `  Summary: **${settings.summary_schedule}**`,
          ]
        : ["  (default settings)"];

      // System info
      const symbolCount = getSymbolCount(db);
      const snapshots = getSnapshotCount(db);

      await interaction.reply({
        content: [
          "**Global Detection Thresholds**",
          ...globalLines,
          "",
          "**Your Personal Settings**",
          ...personalLines,
          "",
          "**System**",
          `  Poll interval: **${envConfig.POLL_INTERVAL_MS / 1000}s**`,
          `  Max rank filter: **${envConfig.MAX_RANK}**`,
          `  Tracked symbols: **${symbolCount}**`,
          `  Snapshots: **${snapshots.oi}** OI, **${snapshots.fr}** FR`,
          "",
          "Change thresholds: `/threshold`  |  Personal: `/config`",
        ].join("\n"),
        ephemeral: true,
      });
      break;
    }

    case "reset-threshold": {
      const keyStr = interaction.options.getString("key", true);

      if (keyStr === "all") {
        const allKeys = Object.keys(TUNABLE_KEYS) as TunableKey[];
        for (const k of allKeys) {
          db.run("DELETE FROM runtime_config WHERE key = ?", [k]);
        }
        await interaction.reply({
          content: "All thresholds reset to env defaults.",
          ephemeral: true,
        });
      } else {
        const key = keyStr as TunableKey;
        db.run("DELETE FROM runtime_config WHERE key = ?", [key]);
        const meta = TUNABLE_KEYS[key];
        const defaultVal = getEffectiveValue(db, envConfig, key);
        await interaction.reply({
          content: `**${meta.label}** を env デフォルト (**${defaultVal}${meta.unit}**) にリセットしました。`,
          ephemeral: true,
        });
      }
      break;
    }
  }
}
