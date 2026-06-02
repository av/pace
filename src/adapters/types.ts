/** Shared identity fields for adapter output and persisted rows (`ContentItemRow` in db.ts). */
export interface ContentItemFields {
  id: string;
  title: string;
  url: string;
  source: string;
}

export interface ContentItem extends ContentItemFields {
  timestamp: Date;
  body?: string;
}

/** Params passed to `Adapter.fetch` (scheduling fields live on `IngestAdapterConfig` in config.ts). */
export interface AdapterConfig {
  type: string;
  params?: Record<string, unknown>;
}

// Re-export for adapters/*.ts only; core modules import errorMessage from ../utils directly.
export { errorMessage } from "../utils";

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
