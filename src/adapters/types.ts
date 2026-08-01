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
  /** Set by LLM summarize transforms; adapters do not populate this field. */
  summary?: string;
  /**
   * Set by the LLM merge transform: the input item ids this merged item was
   * built from, in claim order. Carried so row mapping (`contentItemsToRows`)
   * can attribute the merged item to its first source row without parsing the
   * "+"-joined merged id (which is ambiguous when an original id contains "+").
   * Adapters do not populate this field.
   */
  mergedFromIds?: string[];
}

/** Params passed to `Adapter.fetch` (scheduling fields live on `IngestAdapterConfig` in config.ts). */
export interface AdapterConfig {
  type: string;
  params?: Record<string, unknown>;
}

export interface Adapter {
  name: string;
  /**
   * Fetch content items. Throw `${name}: …` on required fetch failures.
   * Return `[]` for empty params or zero-entry responses. Warn and skip only optional enrichment.
   */
  fetch(config: AdapterConfig): Promise<ContentItem[]>;
  /**
   * Declarative adapters (e.g. bookmarks) derive their items entirely from
   * config, so each fetch result is the COMPLETE set: after saving, the
   * scheduler prunes rows with the `${name}:` id prefix that are absent from
   * the fetched set (entries removed/reordered/renamed in config must not
   * linger). Requires all item ids to be namespaced `${name}:...`. Leave
   * unset for network adapters, where `[]` can mean a transient empty
   * response and cached rows must be retained.
   */
  declarative?: boolean;
}
