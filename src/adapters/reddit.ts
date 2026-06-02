import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
  joinBodyParts,
} from "./engagement";
import { parseUnixEpochSeconds } from "./dates";
import { fetchJson } from "./fetch";
import { dedupeByKey, sliceToLimit } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const REDDIT_BASE = "https://www.reddit.com";
const USER_AGENT = "pace:feed-aggregator/1.0 (github.com/everlier/pace)";

type SortType = "hot" | "new" | "top" | "rising";
type TimePeriod = "hour" | "day" | "week" | "month" | "year" | "all";

const VALID_SORTS = new Set<SortType>(["hot", "new", "top", "rising"]);
const VALID_PERIODS = new Set<TimePeriod>([
  "hour",
  "day",
  "week",
  "month",
  "year",
  "all",
]);

function resolveValidOption<T extends string>(
  value: string | undefined,
  valid: Set<T>,
  fallback: T,
): T {
  if (!value) return fallback;
  const lower = value.toLowerCase();
  return valid.has(lower as T) ? (lower as T) : fallback;
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
  return joinBodyParts(
    formatPoints(post.score),
    formatBy(post.author),
    formatComments(post.num_comments),
    `r/${post.subreddit}`,
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
  const json = await fetchJson<RedditListing>("reddit", url, context, {
    userAgent: USER_AGENT,
  });
  return json?.data?.children ?? [];
}

const adapter: Adapter = {
  name: "reddit",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const subreddits = (config.params?.subreddits as string[]) ?? [];
    const sort = (config.params?.sort as string) ?? "hot";
    const limit = Math.min((config.params?.limit as number) ?? 25, 100);
    const minScore = (config.params?.min_score as number) ?? 0;
    const timePeriod = (config.params?.time as string) ?? "day";

    const effectiveSort = resolveValidOption(sort, VALID_SORTS, "hot" as const);
    const effectivePeriod = resolveValidOption(timePeriod, VALID_PERIODS, "day" as const);

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
      title: post.data.title,
      url: getItemUrl(post.data),
      source: sourceLabel,
      timestamp: parseUnixEpochSeconds(post.data.created_utc),
      body: buildBody(post.data),
    }));
  },
};

export default adapter;
