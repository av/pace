/** Join segments for dashboard titles (body is not shown in the UI). */
export function joinTitle(...parts: (string | undefined | null)[]): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" | ");
}

export type TruncateTextOptions = {
  /** Ellipsis suffix when truncating. Default "…". */
  ellipsis?: string;
  /** When true (default), `max` is total output length including ellipsis. When false, `max` is content length before ellipsis. */
  inclusive?: boolean;
  /** Trim whitespace from input before measuring. Default true. */
  trim?: boolean;
};

/** Cap string length without ellipsis (LLM snippets, feed body previews, stable ID segments). */
export function capText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** Truncate text with ellipsis; used for titles (inclusive) and body snippets (exclusive). */
export function truncateText(
  text: string,
  max: number,
  options: TruncateTextOptions = {},
): string {
  const { ellipsis = "…", inclusive = true, trim = true } = options;
  const source = trim ? text.trim() : text;
  if (source.length <= max) return source;
  const contentMax = inclusive ? max - ellipsis.length : max;
  const slice = inclusive
    ? source.slice(0, contentMax)
    : source.slice(0, contentMax).trimEnd();
  return `${slice}${ellipsis}`;
}

export function truncateForTitle(text: string, max = 100): string {
  return truncateText(text, max);
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