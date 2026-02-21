import type { Database } from "bun:sqlite";
import { getRuntimeConfigValue, upsertRuntimeConfig, getAllRuntimeConfig } from "../db/queries.ts";
import type { Config } from "../config.ts";

/**
 * Keys that can be changed at runtime via /threshold command.
 * env default → DB override (if set).
 */
export const TUNABLE_KEYS = {
  rank_delta_threshold: { label: "ランク変動しきい値", unit: "" },
  rank_delta_window_min: { label: "比較ウィンドウ", unit: "分" },
  min_abs_fr: { label: "FR バッキング閾値", unit: "" },
  max_alerts_per_tick: { label: "1tick 最大通知数", unit: "" },
  ema_short_period: { label: "EMA 短期", unit: "期" },
  ema_long_period: { label: "EMA 長期", unit: "期" },
} as const;

export type TunableKey = keyof typeof TUNABLE_KEYS;

/** Maps tunable key → Config field name for reading env defaults. */
const KEY_TO_CONFIG: Record<TunableKey, keyof Config> = {
  rank_delta_threshold: "RANK_DELTA_THRESHOLD",
  rank_delta_window_min: "RANK_DELTA_WINDOW_MIN",
  min_abs_fr: "MIN_ABS_FR",
  max_alerts_per_tick: "MAX_ALERTS_PER_TICK",
  ema_short_period: "EMA_SHORT_PERIOD",
  ema_long_period: "EMA_LONG_PERIOD",
};

/**
 * Get the effective value for a tunable key.
 * Priority: DB runtime_config → env Config default.
 */
export function getEffectiveValue(db: Database, envConfig: Config, key: TunableKey): number {
  const dbVal = getRuntimeConfigValue(db, key);
  if (dbVal !== null) {
    const n = Number(dbVal);
    if (!Number.isNaN(n)) return n;
  }
  return envConfig[KEY_TO_CONFIG[key]] as number;
}

/**
 * Build the full effective config snapshot used by the detection loop.
 */
export function getEffectiveDetectorConfig(db: Database, envConfig: Config) {
  return {
    rankDeltaThreshold: getEffectiveValue(db, envConfig, "rank_delta_threshold"),
    rankDeltaWindowMin: getEffectiveValue(db, envConfig, "rank_delta_window_min"),
    minAbsFr: getEffectiveValue(db, envConfig, "min_abs_fr"),
    maxAlertsPerTick: getEffectiveValue(db, envConfig, "max_alerts_per_tick"),
    emaShortPeriod: getEffectiveValue(db, envConfig, "ema_short_period"),
    emaLongPeriod: getEffectiveValue(db, envConfig, "ema_long_period"),
  } as const;
}

/**
 * Set a runtime config value (persisted to DB).
 */
export function setRuntimeValue(db: Database, key: TunableKey, value: number): void {
  upsertRuntimeConfig(db, key, String(value));
}

/**
 * Get display table of all tunable params (current value + source).
 */
export function getTunableDisplay(db: Database, envConfig: Config): ReadonlyArray<{
  key: TunableKey;
  label: string;
  value: number;
  source: "env" | "override";
  unit: string;
}> {
  const overrides = new Map(
    getAllRuntimeConfig(db).map((r) => [r.key, r.value]),
  );

  return (Object.keys(TUNABLE_KEYS) as TunableKey[]).map((key) => {
    const meta = TUNABLE_KEYS[key];
    const dbVal = overrides.get(key);
    const hasOverride = dbVal !== null && dbVal !== undefined && !Number.isNaN(Number(dbVal));
    return {
      key,
      label: meta.label,
      value: hasOverride ? Number(dbVal) : (envConfig[KEY_TO_CONFIG[key]] as number),
      source: hasOverride ? "override" as const : "env" as const,
      unit: meta.unit,
    };
  });
}
