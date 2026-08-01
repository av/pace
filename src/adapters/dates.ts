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

const NAIVE_ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Parse feed dates from APIs whose zone-less timestamps are documented as UTC
 * (e.g. Lemmy's naive `published` datetimes). `new Date("2024-01-01T12:00:00")`
 * interprets naive datetimes as LOCAL time, so append "Z" before parsing;
 * strings that already carry a zone designator parse unchanged.
 */
export function parseNaiveUtcFeedDate(dateStr?: string | null): Date {
  if (dateStr != null && NAIVE_ISO_DATETIME.test(dateStr)) {
    return parseFeedDate(`${dateStr.replace(" ", "T")}Z`);
  }
  return parseFeedDate(dateStr);
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