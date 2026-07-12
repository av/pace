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
