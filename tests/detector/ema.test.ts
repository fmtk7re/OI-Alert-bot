import { describe, test, expect } from "bun:test";
import { computeEma, latestEma } from "../../src/lib/ema.ts";

describe("computeEma", () => {
  test("returns empty for empty input", () => {
    expect(computeEma([], 5)).toEqual([]);
  });

  test("returns empty for period < 1", () => {
    expect(computeEma([1, 2, 3], 0)).toEqual([]);
  });

  test("computes EMA for single value", () => {
    const result = computeEma([100], 5);
    expect(result).toEqual([100]);
  });

  test("computes EMA correctly for known values", () => {
    // period=3, k=2/(3+1)=0.5
    // values: [10, 20, 30, 40, 50]
    // seed (SMA of first 3): (10+20+30)/3 = 20
    // EMA[3]: 40*0.5 + 20*0.5 = 30
    // EMA[4]: 50*0.5 + 30*0.5 = 40
    const result = computeEma([10, 20, 30, 40, 50], 3);
    expect(result.length).toBe(3); // seed + 2 more
    expect(result[0]).toBeCloseTo(20, 5);
    expect(result[1]).toBeCloseTo(30, 5);
    expect(result[2]).toBeCloseTo(40, 5);
  });

  test("handles fewer values than period", () => {
    // period=10 but only 3 values — seed is SMA of all 3
    const result = computeEma([10, 20, 30], 10);
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(20, 5);
  });

  test("period=1 tracks raw values closely", () => {
    // k = 2/(1+1) = 1.0
    const result = computeEma([10, 20, 30], 1);
    expect(result[0]).toBe(10);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(30);
  });
});

describe("latestEma", () => {
  test("returns null for empty input", () => {
    expect(latestEma([], 5)).toBeNull();
  });

  test("returns latest EMA value", () => {
    const result = latestEma([10, 20, 30, 40, 50], 3);
    expect(result).toBeCloseTo(40, 5);
  });
});
