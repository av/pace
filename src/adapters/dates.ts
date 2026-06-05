/** Parse a feed/Atom date string; returns now when missing or invalid. */
export function parseFeedDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Parse Unix epoch seconds; returns now when missing or invalid. */
export function parseUnixEpochSeconds(seconds?: number | null): Date {
  if (seconds == null || !Number.isFinite(seconds)) return new Date();
  const d = new Date(seconds * 1000);
  return isNaN(d.getTime()) ? new Date() : d;
}