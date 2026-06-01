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

// Re-export shared helpers from neutral location (src/utils.ts) so that:
// - core non-adapter modules (cli, config, index, scheduler) can import without crossing into adapters/ layer
// - this module's exports remain stable for adapters/*.ts and errorMessage.test.ts (no behavior change)
export { errorMessage, parsePort, isValidPort, getAdapterName } from "../utils";

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
