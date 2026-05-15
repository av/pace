import type { Adapter, AdapterConfig, ContentItem } from "./types";

interface RedditPost {
  data: {
    id: string;
    title: string;
    permalink: string;
    selftext: string;
    created_utc: number;
    subreddit: string;
  };
}

async function fetchSubreddit(
  subreddit: string,
  sort: string,
  limit: number,
): Promise<ContentItem[]> {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "pace/1.0" },
    });
    if (!res.ok) {
      console.warn(`reddit: failed to fetch r/${subreddit}: ${res.status}`);
      return [];
    }
    const json = await res.json();
    const posts: RedditPost[] = json?.data?.children ?? [];

    return posts.map((post) => ({
      id: `reddit:${post.data.id}`,
      title: post.data.title,
      url: `https://reddit.com${post.data.permalink}`,
      source: `reddit:r/${post.data.subreddit}`,
      timestamp: new Date(post.data.created_utc * 1000),
      body: post.data.selftext || undefined,
    }));
  } catch (err) {
    console.warn(`reddit: error fetching r/${subreddit}:`, err);
    return [];
  }
}

const adapter: Adapter = {
  name: "reddit",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const subreddits = (config.params.subreddits as string[]) ?? [];
    const sort = (config.params.sort as string) ?? "hot";
    const limit = (config.params.limit as number) ?? 25;
    const validSorts = ["hot", "new", "top"];
    const effectiveSort = validSorts.includes(sort) ? sort : "hot";

    if (subreddits.length === 0) return [];

    const results = await Promise.all(
      subreddits.map((sub) => fetchSubreddit(sub, effectiveSort, limit)),
    );
    return results.flat();
  },
};

export default adapter;
