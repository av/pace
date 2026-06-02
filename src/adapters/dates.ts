/** Parse a feed/Atom date string; returns now when missing or invalid. */
export function parseFeedDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}