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

/** Primary dashboard title with optional subtitle (repo description, tagline, etc.). */
export function titleWithTagline(
  primary: string,
  tagline?: string | null,
  maxTagline = 100,
): string {
  const t = (tagline ?? "").trim();
  if (!t) return primary;
  const subtitle = maxTagline > 0 ? truncateForTitle(t, maxTagline) : t;
  return joinTitle(primary, subtitle);
}