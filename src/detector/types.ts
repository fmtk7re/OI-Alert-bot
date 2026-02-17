export type Severity = "high" | "medium" | "low";

export type RuleName = "rank-delta" | "new-entry" | "ema-cross";

export type Alert = {
  readonly symbol: string;
  readonly rule: RuleName;
  readonly severity: Severity;
  readonly currentRank: number;
  readonly previousRank: number;
  readonly delta: number;
  readonly windowMinutes: number;
};

export type DetectorContext = {
  readonly ts: string;
  readonly symbols: ReadonlyArray<string>;
  readonly rankDeltaWindowMin: number;
  readonly rankDeltaThreshold: number;
  readonly emaShortPeriod: number;
  readonly emaLongPeriod: number;
  readonly maxRank: number;
  readonly cooldownMin: number;
  readonly minAbsFr: number;
  readonly maxAlertsPerTick: number;
};
