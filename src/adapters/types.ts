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

export interface Adapter {
  name: string;
  /**
   * Fetch content items. Throw `${name}: …` on required fetch failures.
   * Return `[]` for empty params or zero-entry responses. Warn and skip only optional enrichment.
   */
  fetch(config: AdapterConfig): Promise<ContentItem[]>;
}
