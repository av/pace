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
