/** Parse a feed/Atom date string; returns now when missing or invalid. */
export function parseFeedDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Parse Unix epoch seconds; returns now when missing or invalid. */
export function parseUnixEpochSeconds(seconds?: number | null): Date {
  if (seconds == null || !Number.isFinite(seconds)) return new Date();
  const parsed = new Date(seconds * 1000);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

/** Return at most `limit` items from the start of the array. */
export function sliceToLimit<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}