function warnDateFallback(kind: string, detail: string): void {
  console.warn(`dates: ${kind} ${detail}, using current time`);
}

export function parseFeedDate(dateStr?: string | null): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    warnDateFallback("invalid feed date", `"${dateStr}"`);
    return new Date();
  }
  return d;
}

export function parseUnixEpochSeconds(seconds?: number | null): Date {
  if (seconds == null) return new Date();
  if (!Number.isFinite(seconds)) {
    warnDateFallback("invalid epoch seconds", String(seconds));
    return new Date();
  }
  const d = new Date(seconds * 1000);
  if (isNaN(d.getTime())) {
    warnDateFallback("unparseable epoch seconds", String(seconds));
    return new Date();
  }
  return d;
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