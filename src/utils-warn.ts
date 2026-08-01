/**
 * Warn when URL parsing fails; caller returns null (shared by dedupe, layout, etc.).
 * `purpose` is a human-readable phrase (e.g. "dashboard link"), not an internal
 * function name — the message is shown to end users in server/CLI logs.
 */
export function warnUrlParseFailure(
  warnContext: string,
  purpose: string,
  url: string,
  errDetail: string,
): void {
  console.warn(`${warnContext}: cannot parse URL "${url}" for ${purpose}: ${errDetail}`);
}