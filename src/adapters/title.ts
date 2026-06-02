/** Join segments for dashboard titles (body is not shown in the UI). */
export function joinTitle(...parts: (string | undefined | null)[]): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" | ");
}

export function truncateForTitle(text: string, max = 100): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Join primary with optional truncated tagline and more title segments. */
export function joinTitleWithTagline(
  primary: string,
  tagline?: string | null,
  maxTagline = 100,
  ...extra: (string | undefined | null)[]
): string {
  const parts: (string | undefined | null)[] = [primary];
  const t = (tagline ?? "").trim();
  if (t) parts.push(maxTagline > 0 ? truncateForTitle(t, maxTagline) : t);
  parts.push(...extra);
  return joinTitle(...parts);
}

/** Primary dashboard title with optional subtitle (repo description, tagline, etc.). */
export function titleWithTagline(
  primary: string,
  tagline?: string | null,
  maxTagline = 100,
): string {
  return joinTitleWithTagline(primary, tagline, maxTagline);
}