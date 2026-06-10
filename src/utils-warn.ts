/** Warn when URL parsing fails; caller returns null (shared by dedupe, layout, etc.). */
export function warnUrlParseFailure(
  warnContext: string,
  label: string,
  url: string,
  errDetail: string,
): void {
  console.warn(`${warnContext}: ${label} failed for "${url}": ${errDetail}`);
}