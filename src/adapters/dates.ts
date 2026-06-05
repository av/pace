export function parseFeedDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

export function parseUnixEpochSeconds(seconds?: number | null): Date {
  if (seconds == null || !Number.isFinite(seconds)) return new Date();
  const d = new Date(seconds * 1000);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Format a duration in seconds as m:ss or h:mm:ss. */
export function formatSeconds(total: number): string {
  if (total <= 0) return "0:00";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}