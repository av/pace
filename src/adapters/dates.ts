function validDateOrNow(d: Date): Date {
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Parse a feed/Atom date string; returns now when missing or invalid. */
export function parseFeedDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  return validDateOrNow(new Date(dateStr));
}

/** Parse Unix epoch seconds; returns now when missing or invalid. */
export function parseUnixEpochSeconds(seconds?: number | null): Date {
  if (seconds == null || !Number.isFinite(seconds)) return new Date();
  return validDateOrNow(new Date(seconds * 1000));
}