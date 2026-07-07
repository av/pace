import { warnDateParseFallback } from "./empty-config";

export function parseFeedDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    warnDateParseFallback("invalid feed date", `"${dateStr}"`);
    return new Date();
  }
  return d;
}

export function parseUnixEpochSeconds(seconds?: number | null): Date {
  if (seconds == null) return new Date();
  if (!Number.isFinite(seconds)) {
    warnDateParseFallback("invalid epoch seconds", String(seconds));
    return new Date();
  }
  const d = new Date(seconds * 1000);
  if (isNaN(d.getTime())) {
    warnDateParseFallback("unparseable epoch seconds", String(seconds));
    return new Date();
  }
  return d;
}

/** Format a duration in seconds as m:ss or h:mm:ss. */
export function formatSeconds(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "0:00";
  const whole = Math.floor(total);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}