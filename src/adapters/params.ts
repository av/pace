/** Allowed config params per built-in adapter type (validated at config load). */
export const ADAPTER_PARAM_KEYS = {
  hackernews: ["type", "feed", "stories", "limit", "min_score"],
  lobsters: ["feed", "limit", "min_score", "tags"],
  rss: ["urls", "limit"],
  reddit: ["subreddits", "sort", "limit", "min_score", "time"],
  github: ["mode", "language", "since", "limit", "repos", "token"],
  "github-releases": ["repos", "token", "limit"],
  devto: ["tags", "username", "limit", "per_page", "min_reactions", "top"],
  mastodon: ["instance", "hashtags", "accounts", "limit", "min_favourites", "only_media"],
  youtube: ["channels", "playlists", "limit"],
  arxiv: ["categories", "query", "limit"],
  stackexchange: ["site", "tags", "sort", "limit", "min_score"],
  producthunt: ["limit", "min_upvotes", "enrich"],
  podcast: ["feeds", "limit"],
  twitter: ["lists", "searches", "bearer_token"],
  npm: ["keywords", "scope", "limit", "sort"],
  lemmy: ["instance", "communities", "sort", "limit", "min_score"],
  wikipedia: ["modes", "mode", "language", "limit"],
  bookmarks: ["items"],
  counter: ["url", "json_path", "label", "unit", "compare_url", "compare_path", "headers"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type AdapterType = keyof typeof ADAPTER_PARAM_KEYS;

/** Canonical adapter type ids (keys of ADAPTER_PARAM_KEYS). */
export const ADAPTER_TYPES: readonly AdapterType[] = Object.keys(
  ADAPTER_PARAM_KEYS,
) as AdapterType[];

export function isAdapterType(value: string): value is AdapterType {
  return value in ADAPTER_PARAM_KEYS;
}