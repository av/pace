/** Canonical keyword-score entry field keys; single source for validation + types. */
export const KEYWORD_SCORE_ENTRY_FIELDS = ["term", "weight", "regex"] as const;

export type KeywordScoreEntryField = (typeof KEYWORD_SCORE_ENTRY_FIELDS)[number];

/** Canonical transform field keys (excludes discriminant `type`); single source for validation + types. */
export const TRANSFORM_FIELD_KEYS = {
  latest: ["count", "per_source"],
  filter: ["keywords", "fields"],
  exclude: ["keywords", "fields"],
  sort: ["field", "direction"],
  dedupe: ["strategy", "threshold", "keep", "log"],
  "keyword-score": ["keywords", "min_score", "annotate"],
  "time-decay": ["half_life", "engagement_weight", "recency_weight", "decay", "annotate", "min_score"],
  cluster: ["strategy", "min_cluster_size", "max_clusters", "similarity_threshold", "annotate"],
  "llm-summarize": ["fetch_content", "fetch_content_allow_private"],
  "llm-filter": ["criteria"],
  "llm-rank": ["interests"],
  "llm-merge": ["prompt"],
} as const satisfies Record<string, readonly string[]>;

export type TransformType = keyof typeof TRANSFORM_FIELD_KEYS;

/** Canonical transform type ids (keys of TRANSFORM_FIELD_KEYS). */
export const TRANSFORM_TYPES: readonly TransformType[] = Object.keys(
  TRANSFORM_FIELD_KEYS,
) as TransformType[];

/** Allowed YAML keys per transform step (`type` plus variant-specific fields). */
export function transformAllowedFieldKeys(type: TransformType): readonly string[] {
  return ["type", ...TRANSFORM_FIELD_KEYS[type]];
}
