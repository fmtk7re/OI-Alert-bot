import { z } from "zod";

const oiRankValue = z
  .string()
  .transform((val, ctx): number => {
    if (val === "500+") return 501;
    const n = Number(val);
    if (Number.isNaN(n) || n < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid OI rank value: ${val}`,
      });
      return z.NEVER;
    }
    return n;
  });

const fundingRateEntry = z.record(z.string(), z.number());

export const lorisResponseSchema = z.object({
  oi_rankings: z.record(z.string(), oiRankValue),
  funding_rates: z.record(z.string(), fundingRateEntry),
});

export type LorisResponse = Readonly<z.output<typeof lorisResponseSchema>>;

export type OiRankings = LorisResponse["oi_rankings"];
export type FundingRates = LorisResponse["funding_rates"];
