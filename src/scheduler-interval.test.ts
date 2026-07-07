import { describe, expect, test } from "bun:test";
import {
  computeRefreshInterval,
  DEFAULT_REFRESH_INTERVAL_MIN,
  MAX_REFRESH_INTERVAL_MIN,
  MAX_TIMER_DELAY_MS,
  MIN_REFRESH_INTERVAL_MIN,
} from "./scheduler-runtime";

describe("computeRefreshInterval", () => {
  test("defaults when refresh_interval is omitted", () => {
    const { intervalMin, intervalMs } = computeRefreshInterval(undefined);
    expect(intervalMin).toBe(DEFAULT_REFRESH_INTERVAL_MIN);
    expect(intervalMs).toBe(DEFAULT_REFRESH_INTERVAL_MIN * 60_000);
  });

  test("clamps below the minimum", () => {
    expect(computeRefreshInterval(0).intervalMin).toBe(MIN_REFRESH_INTERVAL_MIN);
    expect(computeRefreshInterval(-5).intervalMin).toBe(MIN_REFRESH_INTERVAL_MIN);
  });

  test("passes through normal values", () => {
    expect(computeRefreshInterval(90)).toEqual({ intervalMin: 90, intervalMs: 90 * 60_000 });
  });

  test("clamps values that would overflow the 32-bit setInterval delay", () => {
    // 60000 minutes = 3.6e9 ms > 2^31-1; setInterval would clamp to ~1ms
    // causing a tight refresh loop. Must be capped instead.
    const { intervalMin, intervalMs } = computeRefreshInterval(60_000);
    expect(intervalMin).toBe(MAX_REFRESH_INTERVAL_MIN);
    expect(intervalMs).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS);
    expect(intervalMs).toBe(MAX_REFRESH_INTERVAL_MIN * 60_000);
  });

  test("largest non-clamped value stays under the timer delay cap", () => {
    const { intervalMs } = computeRefreshInterval(MAX_REFRESH_INTERVAL_MIN);
    expect(intervalMs).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS);
  });

  test("Infinity is clamped rather than propagated", () => {
    expect(computeRefreshInterval(Number.POSITIVE_INFINITY).intervalMin).toBe(
      MAX_REFRESH_INTERVAL_MIN,
    );
  });
});
