import type { AdapterConfig } from "../adapters/types";
import type { LayoutNodeConfig } from "../layout/types";
import {
  KEYWORD_SCORE_ENTRY_FIELDS,
  TRANSFORM_FIELD_KEYS,
  type KeywordScoreEntryField,
  type TransformType,
} from "../transform-schema";

export interface KeywordScoreEntry {
  term: string;
  weight: number;
  regex?: boolean;
}

type AssertKeywordScoreEntryFieldsAlign =
  keyof KeywordScoreEntry extends KeywordScoreEntryField
    ? KeywordScoreEntryField extends keyof KeywordScoreEntry
      ? true
      : ["KEYWORD_SCORE_ENTRY_FIELDS has extra fields"]
    : ["KeywordScoreEntry has extra fields"];

declare const _keywordScoreEntryFieldsDriftGuard: AssertKeywordScoreEntryFieldsAlign;

export type KeywordField = "title" | "body" | "source";

export const KEYWORD_FIELDS: readonly KeywordField[] = ["title", "body", "source"];

export const DEDUPE_STRATEGIES = ["url", "domain-normalized", "title-similarity"] as const;
export type DedupeStrategy = (typeof DEDUPE_STRATEGIES)[number];

export const DEDUPE_KEEP_OPTIONS = ["highest-score", "earliest", "latest"] as const;
export type DedupeKeep = (typeof DEDUPE_KEEP_OPTIONS)[number];

export const SORT_FIELDS = ["timestamp", "title", "source"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const DECAY_TYPES = ["exponential", "linear"] as const;
export type DecayType = (typeof DECAY_TYPES)[number];

export const CLUSTER_STRATEGIES = ["domain", "keywords", "source", "auto"] as const;
export type ClusterStrategy = (typeof CLUSTER_STRATEGIES)[number];

/** Runtime defaults for dedupe transform (must match apply logic in transforms.ts). */
export const DEDUPE_DEFAULT_STRATEGY: DedupeStrategy = "url";
export const DEDUPE_DEFAULT_THRESHOLD = 0.85;
export const DEDUPE_DEFAULT_KEEP: DedupeKeep = "highest-score";

export function isDedupeStrategy(value: string): value is DedupeStrategy {
  return (DEDUPE_STRATEGIES as readonly string[]).includes(value);
}

export type TransformConfig =
  | { type: "latest"; count: number; per_source?: number }
  | { type: "filter"; keywords: string[]; fields?: KeywordField[] }
  | { type: "exclude"; keywords: string[]; fields?: KeywordField[] }
  | { type: "sort"; field: SortField; direction?: SortDirection }
  | { type: "dedupe"; strategy?: DedupeStrategy; threshold?: number; keep?: DedupeKeep; log?: boolean }
  | { type: "keyword-score"; keywords: KeywordScoreEntry[]; min_score?: number; annotate?: boolean }
  | { type: "time-decay"; half_life?: string; engagement_weight?: number; recency_weight?: number; decay?: DecayType; annotate?: boolean; min_score?: number }
  | { type: "cluster"; strategy?: ClusterStrategy; min_cluster_size?: number; max_clusters?: number; similarity_threshold?: number; annotate?: boolean }
  | { type: "llm-summarize"; fetch_content?: boolean; fetch_content_allow_private?: boolean }
  | { type: "llm-filter"; criteria: string }
  | { type: "llm-rank"; interests?: string[] }
  | { type: "llm-merge"; prompt?: string };

type TransformConfigFieldKeys<T extends TransformType> = Exclude<
  keyof Extract<TransformConfig, { type: T }>,
  "type"
>;

type TransformSchemaFieldKeys<T extends TransformType> = (typeof TRANSFORM_FIELD_KEYS)[T][number];

type AssertTransformFieldKeysAlign<T extends TransformType> =
  TransformConfigFieldKeys<T> extends TransformSchemaFieldKeys<T>
    ? TransformSchemaFieldKeys<T> extends TransformConfigFieldKeys<T>
      ? true
      : ["TRANSFORM_FIELD_KEYS has extra fields", T]
    : ["TransformConfig has extra fields", T];

type AssertTransformTypesMatch =
  TransformConfig["type"] extends TransformType
    ? TransformType extends TransformConfig["type"]
      ? true
      : ["TRANSFORM_FIELD_KEYS has extra transform type"]
    : ["TransformConfig has extra transform type"];

type AssertTransformSchemaDrift =
  AssertTransformTypesMatch extends true
    ? {
        [T in TransformType]: AssertTransformFieldKeysAlign<T> extends true
          ? true
          : AssertTransformFieldKeysAlign<T>;
      }[TransformType] extends true
      ? true
      : never
    : never;

declare const _transformSchemaDriftGuard: AssertTransformSchemaDrift;

export interface LlmConfig {
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
  interests?: string[];
  /** Seconds allowed per LLM completion (default 120); raise for slow local models. */
  timeout_seconds?: number;
}

export interface IngestAdapterConfig extends AdapterConfig {
  name?: string;
  /** Minutes between scheduled fetches (default 15, minimum 1); not read by `Adapter.fetch`. */
  refresh_interval?: number;
  transforms?: TransformConfig[];
}

export interface PipelineConfig {
  name: string;
  sources: string[];
  transforms: TransformConfig[];
  refresh_interval?: number;
}

/**
 * One webhook notification rule (top-level `notify:` list). After every
 * refresh, items on the refreshed panels that match ALL configured criteria
 * (and were not already notified) are POSTed as JSON to `url`. At least one
 * of `min_score` / `keywords` must be set so a rule is always intentional.
 */
export interface NotifyRuleConfig {
  /** Webhook endpoint; https, or http on localhost (same policy as other config URLs). */
  url: string;
  /** Optional label; used in the payload and logs (defaults to the url). */
  name?: string;
  /** Notify only items with an llm-rank/keyword score >= this value. */
  min_score?: number;
  /** Notify only items containing any of these keywords (case-insensitive, title/body/summary). */
  keywords?: string[];
  /** Restrict the rule to these panel ids (default: every refreshed panel). */
  panels?: string[];
  /**
   * Delivery format preset: raw "json" payload (default), or a body shaped
   * for "ntfy" (plain text + title/click headers), "discord" (webhook
   * `content` markdown), "slack" (incoming-webhook `text` mrkdwn), or
   * "template" (the rule's own `template` string with `{{placeholder}}`
   * substitution). Presentation only — never affects matching or the
   * delivery ledger.
   */
  format?: "json" | "ntfy" | "discord" | "slack" | "template";
  /**
   * User-defined delivery body for `format: template`. Placeholders:
   * `{{rule}}`, `{{matched}}`, `{{headline}}`, `{{items}}` (plain-text
   * bullet list). Required with — and only valid with — `format: template`.
   */
  template?: string;
  /**
   * Optional per-item line for `{{items}}` in `format: template` — rendered
   * once per delivered item instead of the default bullet list (the
   * `…and N more` overflow line is kept). Placeholders: `{{title}}`,
   * `{{url}}`, `{{source}}`, `{{score}}` (empty when unscored), `{{meta}}`
   * ("source" / "source, score N"). Only valid with `format: template`.
   */
  item_template?: string;
  /**
   * Extra HTTP headers sent with every delivery to this rule's webhook —
   * typically auth (`Authorization: Bearer ${TOKEN}` via env expansion, ntfy
   * access tokens, shared-secret headers). Merged over the format preset's
   * headers; `Content-Type` stays preset-owned (rejected at validation).
   * Transport only — never affects matching or the delivery ledger.
   */
  headers?: Record<string, string>;
}

export interface ServerConfig {
  base_path?: string;
  /**
   * How many days of fetched items to keep in the database (default 30).
   * Must be a positive integer, or 0 to disable pruning entirely.
   */
  retention_days?: number;
}

export interface AppConfig {
  adapters: IngestAdapterConfig[];
  pipelines?: PipelineConfig[];
  layout: LayoutNodeConfig;
  llm?: LlmConfig;
  server?: ServerConfig;
  notify?: NotifyRuleConfig[];
}

export const DEFAULT_LAYOUT: LayoutNodeConfig = {
  direction: "row",
  children: [{ panel: "all", source: "all", limit: 50 }],
};

export function normalizeBasePath(raw?: string): string {
  if (!raw) return "";
  let p = raw.trim();
  if (!p.startsWith("/")) p = "/" + p;
  if (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export interface ConfigPathResolution {
  path: string;
  explicit: boolean;
}

export interface ConfigReadResult {
  raw: string;
  usedConfigPath: string;
}

export type ConfigFileReader = (path: string) => string | null;
