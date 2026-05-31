export interface ContentItem {
  id: string;
  title: string;
  url: string;
  source: string;
  timestamp: Date;
  body?: string;
}

export interface AdapterConfig {
  type: string;
  params?: Record<string, unknown>;
  refresh_interval?: number;
}

/**
 * Shared helper to normalize unknown errors to string message.
 * Used by all adapters for consistent "name: ..." thrown errors.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string") {
    return (err as any).message;
  }
  return String(err);
}

/**
 * Parses a port number from string input (e.g. process.env.PORT or CLI --port arg).
 * Returns the number if valid integer in [1,65535], otherwise the fallback (default 7453).
 * Single source of truth eliminating duplicated parseInt+range checks in cli.ts and index.ts.
 */
export function parsePort(input: string | undefined, fallback = 7453): number {
  const n = parseInt(input ?? String(fallback), 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    return fallback;
  }
  return n;
}

/** Returns true iff n is a finite integer port in the valid range [1, 65535]. */
export function isValidPort(n: number): boolean {
  return !isNaN(n) && n >= 1 && n <= 65535;
}

/**
 * Returns the effective name for an adapter config entry, preferring the explicit `name` (for display/alias) over the `type`.
 * Single source of truth for the `name ?? type` fallback, eliminating duplication across config validation, scheduler setup, and index bootstrap/refresh.
 */
export function getAdapterName(cfg: { name?: string; type: string }): string {
  return cfg.name ?? cfg.type;
}

export interface Adapter {
  name: string;
  /**
   * Fetch content items for the given config.
   * MUST throw Error (not swallow with console.warn + return []) on:
   * - network failures (dns, timeout, connection)
   * - non-2xx HTTP responses for required fetches
   * - parse failures (bad xml/json)
   * - auth failures (401/403 from tokens)
   * Error message MUST start with `${name}: ` prefix (e.g. "rss: error fetching ...")
   * to allow easy identification and lastError propagation in scheduler.
   * Return [] ONLY for valid "no sources configured" cases (not on fetch errors).
   * Use the exported errorMessage() helper for cause strings.
   */
  fetch(config: AdapterConfig): Promise<ContentItem[]>;
}
