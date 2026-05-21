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
  return err instanceof Error ? err.message : String(err);
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
