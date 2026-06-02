import { fetchWithTimeout } from "./fetch";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

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

/**
 * Resolve a user-supplied string value against a set of valid options (case-insensitive).
 * Returns the canonical form if valid, else the fallback.
 * Single source of truth for the duplicated sort/timePeriod resolution logic.
 */
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
  const parts: string[] = [];

  parts.push(`${post.score} points`);
  parts.push(`by ${post.author}`);
  parts.push(`${post.num_comments} comments`);
  parts.push(`r/${post.subreddit}`);

  // Include discussion link for external URLs
  const discussLink = `https://reddit.com${post.permalink}`;
  if (!post.is_self) {
    parts.push(`discuss: ${discussLink}`);
  }

  return parts.join(" | ");
}

function getItemUrl(post: RedditPostData): string {
  // For self posts, link to the Reddit thread
  // For link posts, use the external URL
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

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { userAgent: USER_AGENT });
  } catch (err) {
    throw new Error(`reddit: error fetching ${path}/${sort}: ${errorMessage(err)}`);
  }

  if (!res.ok) {
    const detail = errorMessage({ message: String(res.status) });
    throw new Error(
      `reddit: error fetching ${path}/${sort}: reddit: failed to fetch ${path}/${sort}: ${detail}`,
    );
  }

  try {
    const json: RedditListing = await res.json();
    return json?.data?.children ?? [];
  } catch (err) {
    throw new Error(`reddit: error fetching ${path}/${sort}: ${errorMessage(err)}`);
  }
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

    // Fetch all configured subreddits
    // Support multireddits via "+" in name (e.g., "programming+typescript+rust")
    const allPosts: RedditPost[] = [];

    for (const sub of subreddits) {
      // sub can be "programming" or "programming+typescript+rust" (multireddit)
      const path = `/r/${sub}`;
      const posts = await fetchRedditListing(
        path,
        effectiveSort,
        limit,
        effectivePeriod,
      );
      allPosts.push(...posts);
    }

    // Deduplicate by post ID (possible overlap in multireddits or multiple subs)
    const seen = new Set<string>();
    const deduped = allPosts.filter((post) => {
      if (seen.has(post.data.id)) return false;
      seen.add(post.data.id);
      return true;
    });

    // Apply score filter
    const filtered =
      minScore > 0
        ? deduped.filter((post) => post.data.score >= minScore)
        : deduped;

    // Sort by score descending for consistent ordering across multi-sub fetches
    filtered.sort((a, b) => b.data.score - a.data.score);

    // Apply limit
    const limited = filtered.slice(0, limit);

    // Build source label
    const sourceLabel =
      subreddits.length === 1
        ? `reddit:r/${subreddits[0]}`
        : `reddit:${effectiveSort}`;

    return limited.map((post) => ({
      id: `reddit:${post.data.id}`,
      title: post.data.title,
      url: getItemUrl(post.data),
      source: sourceLabel,
      timestamp: new Date(post.data.created_utc * 1000),
      body: buildBody(post.data),
    }));
  },
};

export default adapter;
