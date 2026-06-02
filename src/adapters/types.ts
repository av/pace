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
   *
   * Throw (`Error`, `${name}: …` prefix) when a required fetch fails so the
   * scheduler can record `lastError`: network/timeout, non-2xx HTTP, bad
   * XML/JSON on the primary response, and auth errors on token-backed APIs.
   * Never downgrade these to `console.warn` + `[]`.
   *
   * Return `[]` without throwing when there is nothing to return: empty source
   * lists in `params`, or a successful primary response with zero usable entries
   * (e.g. empty Atom `<entry>`). Use `console.warn` when empty results likely
   * mean misconfiguration (missing subreddits, tags, repos, etc.).
   *
   * Warn and continue only for optional secondary fetches (per-item enrichment,
   * account lookup): `console.warn` with `errorMessage`, skip that item, return
   * the rest.
   */
  fetch(config: AdapterConfig): Promise<ContentItem[]>;
}
