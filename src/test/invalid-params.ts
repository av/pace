/** Invalid adapter limit values for test.each — includes 0 (invalid, triggers default). */
export function invalidLimitParams(validDefault: string | number): unknown[] {
  return [NaN, String(validDefault), Infinity, -5, 0];
}

/** Invalid min_score / threshold params — 0 is valid (no filter), so omitted. */
export function invalidMinScoreParams(validDefault: string | number): unknown[] {
  return [NaN, String(validDefault), Infinity, -5];
}