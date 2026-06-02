function hasStringMessage(err: unknown): err is { message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as Record<string, unknown>).message === "string"
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (hasStringMessage(err)) return err.message;
  return String(err);
}

export function parsePort(input: string | undefined, fallback = 7453): number {
  const n = parseInt(input ?? String(fallback), 10);
  return isValidPort(n) ? n : fallback;
}

export function isValidPort(n: number): boolean {
  return !isNaN(n) && n >= 1 && n <= 65535;
}

export function getAdapterName(cfg: { name?: string; type: string }): string {
  return cfg.name ?? cfg.type;
}

/**
 * Compare ISO-8601 timestamp strings for `Array.sort`.
 * Ties return 0; with stable sort, equal timestamps keep their prior order
 * (e.g. source concat order in `runPipelineJob`, or input order in transforms).
 */
export function compareIsoTimestamp(
  a: string,
  b: string,
  direction: "asc" | "desc" = "desc",
): number {
  const descCmp = b > a ? 1 : b < a ? -1 : 0;
  const cmp = direction === "asc" ? -descCmp : descCmp;
  return cmp === 0 ? 0 : cmp;
}

/** Return at most `limit` items from the start of the array. */
export function sliceToLimit<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}

/** Trim each string and drop empty entries (after trim). */
export function normalizeStringList(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

/** Trim optional string; return undefined if missing or blank after trim. */
export function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

/** Coerce optional param to a finite non-negative number; invalid values → fallback (default 0). */
export function normalizeNonNegativeNumber(
  value: unknown,
  fallback = 0,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

/** Coerce optional param to a positive integer; invalid values → fallback (default 1). */
export function normalizePositiveInteger(
  value: unknown,
  fallback = 1,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}
