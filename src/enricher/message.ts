import type { EnrichedAlert } from "./funding.ts";

type DiscordEmbed = {
  readonly title: string;
  readonly color: number;
  readonly fields: ReadonlyArray<{ readonly name: string; readonly value: string; readonly inline?: boolean }>;
  readonly footer: { readonly text: string };
  readonly timestamp: string;
};

const SEVERITY_COLORS: Record<string, number> = {
  high: 0xff0000,
  medium: 0xffaa00,
  low: 0x3498db,
} as const;

const SEVERITY_LABELS: Record<string, string> = {
  high: "🔴 HIGH",
  medium: "🟡 MEDIUM",
  low: "🔵 LOW",
} as const;

function formatFundingRates(rates: EnrichedAlert["fundingRates"]): string {
  if (rates.length === 0) return "N/A";
  const lines = rates
    .slice(0, 10)
    .map((r) => `${r.exchange}: ${r.rate.toFixed(4)}`);
  if (rates.length > 10) {
    lines.push(`... +${rates.length - 10} more`);
  }
  return lines.join("\n");
}

function formatSpread(spread: EnrichedAlert["maxSpread"]): string {
  if (!spread) return "N/A";
  return `${spread.highExchange} / ${spread.lowExchange}: ${spread.spread.toFixed(4)}`;
}

export function buildEmbed(alert: EnrichedAlert, ts: string): DiscordEmbed {
  const arrow = alert.delta > 0 ? "↑" : "↓";
  return {
    title: `${SEVERITY_LABELS[alert.severity] ?? alert.severity} — ${alert.symbol}`,
    color: SEVERITY_COLORS[alert.severity] ?? 0x808080,
    fields: [
      {
        name: "Rank Change",
        value: `${alert.previousRank} → ${alert.currentRank} (Δ${alert.delta} ${arrow}, ${alert.windowMinutes}min)`,
        inline: true,
      },
      {
        name: "Rule",
        value: `${alert.rule} (${alert.severity})`,
        inline: true,
      },
      {
        name: "Funding Rates (rate desc)",
        value: formatFundingRates(alert.fundingRates),
      },
      {
        name: "Max FR Spread",
        value: formatSpread(alert.maxSpread),
        inline: true,
      },
    ],
    footer: {
      text: "Data by Loris Tools https://loris.tools",
    },
    timestamp: ts,
  };
}
