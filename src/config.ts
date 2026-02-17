import { z } from "zod";

const configSchema = z.object({
  LORIS_API_URL: z.string().url().default("https://api.loris.tools/funding"),
  POLL_INTERVAL_MS: z.coerce.number().int().min(10_000).default(60_000),
  RANK_DELTA_WINDOW_MIN: z.coerce.number().int().min(1).default(30),
  RANK_DELTA_THRESHOLD: z.coerce.number().int().min(1).default(30),
  EMA_SHORT_PERIOD: z.coerce.number().int().min(1).default(5),
  EMA_LONG_PERIOD: z.coerce.number().int().min(2).default(20),
  MAX_RANK: z.coerce.number().int().min(1).default(300),
  COOLDOWN_MIN: z.coerce.number().int().min(0).default(120),
  MIN_ABS_FR: z.coerce.number().min(0).default(5),
  DISCORD_WEBHOOK_URL: z.string().url(),
  DISCORD_ADMIN_WEBHOOK_URL: z.string().url().optional(),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  DISCORD_ALERT_CHANNEL_ID: z.string().min(1).optional(),
  MAX_ALERTS_PER_TICK: z.coerce.number().int().min(1).default(10),
  OI_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  FR_RETENTION_DAYS: z.coerce.number().int().min(1).default(3),
  ALERT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  DB_PATH: z.string().default("data/oi-alert.db"),
  WEB_PORT: z.coerce.number().int().min(1).default(3000),
  WEB_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  SUMMARY_DAILY_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(0),
  SUMMARY_WEEKLY_DAY: z.coerce.number().int().min(0).max(6).default(1),
});

export type Config = Readonly<z.infer<typeof configSchema>>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${formatted}`);
  }
  return Object.freeze(result.data);
}
