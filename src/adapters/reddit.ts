import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
  formatSubreddit,
} from "./engagement";
import { joinTitle } from "./title";

import { parseUnixEpochSeconds } from "./dates";
import { fetchJson } from "./fetch";
import { decodeNumericFeedTitle } from "./html";
import {
  normalizeNonNegativeNumber,
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  sliceToLimit,
} from "../utils";
import { dedupeByKey } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const REDDIT_BASE = "https://www.reddit.com";

type SortType = "hot" | "new" | "top" | "rising";
type TimePeriod = "hour" | "day" | "week" | "month" | "year" | "all";

const SORT_TYPES: Record<string, SortType> = {
  hot: "hot",
  new: "new",
  top: "top",
  rising: "rising",
};

const SORT_ALIASES: Record<string, SortType> = {
  popular: "hot",
  trending: "rising",
  best: "top",
};

/** Map configured sort string (canonical name or alias) to Reddit listing sort. Unknown → hot. */
export function resolveRedditSort(sort: string): SortType {
  const lower = sort.toLowerCase();
  if (lower in SORT_TYPES) return SORT_TYPES[lower];
  return SORT_ALIASES[lower] ?? "hot";
}

const PERIOD_TYPES: Record<string, TimePeriod> = {
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
  all: "all",
};

const PERIOD_ALIASES: Record<string, TimePeriod> = {
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
};

/** Map configured time period string (canonical name or alias) to Reddit top-sort window. Unknown → day. */
export function resolveRedditPeriod(period: string): TimePeriod {
  const lower = period.toLowerCase();
  if (lower in PERIOD_TYPES) return PERIOD_TYPES[lower];
  return PERIOD_ALIASES[lower] ?? "day";
}

interface RedditPostData {
  id: string;
  title: string;
  permalink: string;
  url: string;
  selftext: string;
  is_self: boolean;
  created_utc: number;
  subreddit: string;
  score: number;
  num_comments: number;
  author: string;
}

interface RedditPost {
  data: RedditPostData;
}

interface RedditListing {
  data: {
    children: RedditPost[];
  };
}

function buildBody(post: RedditPostData): string {
  const discussLink = `https://reddit.com${post.permalink}`;
  return joinTitle(
    formatPoints(post.score),
    formatBy(post.author),
    formatComments(post.num_comments),
    formatSubreddit(post.subreddit),
    !post.is_self ? formatDiscuss(discussLink) : undefined,
  );
}

function getItemUrl(post: RedditPostData): string {
  if (post.is_self) {
    return `https://reddit.com${post.permalink}`;
  }
  return post.url;
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
  const json = await fetchJson<RedditListing>("reddit", url, context);
  return json?.data?.children ?? [];
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
      console.warn("reddit: no subreddits configured");
      return [];
    }

    const allPosts: RedditPost[] = [];

    for (const sub of subreddits) {
      const path = `/r/${sub}`;
      const posts = await fetchRedditListing(
        path,
        effectiveSort,
        limit,
        effectivePeriod,
      );
      allPosts.push(...posts);
    }

    const deduped = dedupeByKey(allPosts, (post) => post.data.id);

    const filtered =
      minScore > 0
        ? deduped.filter((post) => post.data.score >= minScore)
        : deduped;

    filtered.sort((a, b) => b.data.score - a.data.score);

    const limited = sliceToLimit(filtered, limit);

    const sourceLabel =
      subreddits.length === 1
        ? `reddit:r/${subreddits[0]}`
        : `reddit:${effectiveSort}`;

    return limited.map((post) => ({
      id: `reddit:${post.data.id}`,
      title: decodeNumericFeedTitle(post.data.title),
      url: getItemUrl(post.data),
      source: sourceLabel,
      timestamp: parseUnixEpochSeconds(post.data.created_utc),
      body: buildBody(post.data),
    }));
  },
};

export default adapter;
