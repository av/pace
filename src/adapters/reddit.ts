import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
  formatSubreddit,
} from "./engagement";
import { joinTitle } from "./title";

import { parseUnixEpochSeconds } from "./dates";
import { warnEmptyConfig } from "./empty-config";
import { fetchJson, jsonObjectOrNull, objectArrayFieldOrEmpty } from "./fetch";
import { decodeNumericFeedTitle } from "./html";
import {
  normalizeNonNegativeNumber,
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  createAliasedResolver,
} from "../utils";
import { mapToContentItems } from "./content-item";
import { aggregateSequentialFeeds } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const REDDIT_BASE = "https://www.reddit.com";

type SortType = "hot" | "new" | "top" | "rising";
type TimePeriod = "hour" | "day" | "week" | "month" | "year" | "all";

/** Build reddit source label: single subreddit uses r/name, multiple uses sort. */
export function redditSourceLabel(
  subreddits: readonly string[],
  effectiveSort: string,
): string {
  return subreddits.length === 1
    ? `reddit:r/${subreddits[0]}`
    : `reddit:${effectiveSort}`;
}

/** Map configured sort string (canonical name or alias) to Reddit listing sort. Unknown → hot. */
export const resolveRedditSort = createAliasedResolver<SortType>({
  types: ["hot", "new", "top", "rising"],
  aliases: { popular: "hot", trending: "rising", best: "top" },
  fallback: "hot",
});

/** Map configured time period string (canonical name or alias) to Reddit top-sort window. Unknown → day. */
export const resolveRedditPeriod = createAliasedResolver<TimePeriod>({
  types: ["hour", "day", "week", "month", "year", "all"],
  aliases: {
    "24h": "day",
    "1d": "day",
    daily: "day",
    "7d": "week",
    weekly: "week",
    "30d": "month",
    monthly: "month",
    "1y": "year",
    yearly: "year",
    alltime: "all",
    forever: "all",
  },
  fallback: "day",
});

/**
 * Only `id` and `title` are required (REDDIT_POST_REQUIRED_FIELDS); everything
 * else is defaulted at use sites so a partial post degrades instead of crashing
 * the whole fetch.
 */
interface RedditPostData {
  id: string;
  title: string;
  permalink?: string;
  url?: string;
  selftext?: string;
  is_self?: boolean;
  created_utc?: number;
  subreddit?: string;
  score?: number;
  num_comments?: number;
  author?: string;
}

interface RedditPost {
  data: RedditPostData;
}

/**
 * Dot paths: identity fields read unguarded downstream (dedupeKey, item id,
 * title). A listing element missing these is dropped with a warn instead of
 * crashing the whole reddit fetch.
 */
const REDDIT_POST_REQUIRED_FIELDS = ["data.id", "data.title"] as const;

interface RedditListing {
  data: {
    children: RedditPost[];
  };
}

function permalinkUrl(post: RedditPostData): string {
  return post.permalink ? `https://reddit.com${post.permalink}` : "";
}

function buildBody(post: RedditPostData): string {
  const discussLink = permalinkUrl(post);
  return joinTitle(
    formatPoints(post.score ?? 0),
    post.author ? formatBy(post.author) : undefined,
    formatComments(post.num_comments ?? 0),
    post.subreddit ? formatSubreddit(post.subreddit) : undefined,
    !post.is_self && discussLink ? formatDiscuss(discussLink) : undefined,
  );
}

function getItemUrl(post: RedditPostData): string {
  if (post.is_self) {
    return permalinkUrl(post);
  }
  return post.url ?? permalinkUrl(post);
}

async function fetchRedditListing(
  path: string,
  sort: SortType,
  limit: number,
  timePeriod: TimePeriod,
): Promise<RedditPost[]> {
  let url = `${REDDIT_BASE}${path}/${sort}.json?limit=${limit}&raw_json=1`;
  if (sort === "top") {
    url += `&t=${timePeriod}`;
  }

  const context = `${path}/${sort}`;
  const raw = await fetchJson<unknown>("reddit", url, context);
  const json = jsonObjectOrNull<RedditListing>("reddit", raw, context, ["data"]);
  if (json == null) return [];
  return objectArrayFieldOrEmpty<RedditPost>(
    "reddit",
    json.data,
    "children",
    context,
    REDDIT_POST_REQUIRED_FIELDS,
  );
}

const adapter: Adapter = {
  name: "reddit",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const subreddits = normalizeParamStringList(config.params, "subreddits");
    const sort = normalizeParamString(config.params, "sort", "hot");
    const limit = clampAdapterLimit(config.params?.limit, 25, 100);
    const minScore = normalizeNonNegativeNumber(config.params?.min_score);
    const timePeriod = normalizeParamString(config.params, "time", "day");

    const effectiveSort = resolveRedditSort(sort);
    const effectivePeriod = resolveRedditPeriod(timePeriod);

    if (subreddits.length === 0) {
      return warnEmptyConfig("reddit", "no subreddits configured");
    }

    const limited = await aggregateSequentialFeeds(
      subreddits,
      // Encode the user-configured name: a stray space/`?`/`#` would otherwise
      // silently truncate or malform the request path (siblings all encode).
      (sub) => fetchRedditListing(`/r/${encodeURIComponent(sub)}`, effectiveSort, limit, effectivePeriod),
      {
        limit,
        dedupeKey: (post) => post.data.id,
        minScore,
        scoreOf: (post) => post.data.score ?? 0,
        sort: (a, b) => (b.data.score ?? 0) - (a.data.score ?? 0),
      },
    );

    return mapToContentItems(
      limited,
      redditSourceLabel(subreddits, effectiveSort),
      (post) => ({
      id: `reddit:${post.data.id}`,
      title: decodeNumericFeedTitle(post.data.title),
      url: getItemUrl(post.data),
      timestamp: parseUnixEpochSeconds(post.data.created_utc),
      body: buildBody(post.data),
    }),
    );
  },
};

export default adapter;
