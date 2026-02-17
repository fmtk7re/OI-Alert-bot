import { describe, test, expect } from "bun:test";
import { lorisResponseSchema } from "../../src/collector/schema.ts";
import fixtureData from "../fixtures/loris-response.json";

describe("lorisResponseSchema", () => {
  test("parses valid response", () => {
    const result = lorisResponseSchema.safeParse(fixtureData);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.oi_rankings["BTCUSDT"]).toBe(1);
    expect(result.data.oi_rankings["ETHUSDT"]).toBe(2);
    expect(result.data.oi_rankings["SOLUSDT"]).toBe(15);
    expect(result.data.oi_rankings["SHIBUSDT"]).toBe(501);
  });

  test("transforms 500+ to 501", () => {
    const result = lorisResponseSchema.safeParse({
      oi_rankings: { "TEST": "500+" },
      funding_rates: {},
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.oi_rankings["TEST"]).toBe(501);
  });

  test("rejects invalid oi_rank values", () => {
    const result = lorisResponseSchema.safeParse({
      oi_rankings: { "TEST": "abc" },
      funding_rates: {},
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing oi_rankings", () => {
    const result = lorisResponseSchema.safeParse({
      funding_rates: {},
    });
    expect(result.success).toBe(false);
  });

  test("parses funding rates correctly", () => {
    const result = lorisResponseSchema.safeParse(fixtureData);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.funding_rates["Binance"]?.["BTCUSDT"]).toBe(10.5);
    expect(result.data.funding_rates["Hyperliquid"]?.["SOLUSDT"]).toBe(13.2);
  });
});
