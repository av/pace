import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";
// from "./types" errorMessage helper (verifier s7s for bugbash-iter11)

const HN_API = "https://hacker-news.firebaseio.com/v0";
const BATCH_SIZE = 10;

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  time?: number;
  type?: string;
  by?: string;
  descendants?: number; // comment count
}

type FeedType = "top" | "new" | "best" | "ask" | "show" | "job";

const FEED_ENDPOINTS: Record<FeedType, string> = {
  top: "topstories",
  new: "newstories",
  best: "beststories",
  ask: "askstories",
  show: "showstories",
  job: "jobstories",
};

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    const res = await fetch(`${HN_API}/item/${id}.json`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchInBatches(ids: number[]): Promise<HNItem[]> {
  const results: HNItem[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const items = await Promise.all(batch.map(fetchItem));
    for (const item of items) {
      if (item) results.push(item);
    }
  }
  return results;
}

function buildBody(item: HNItem): string {
  const parts: string[] = [];
  if (item.score !== undefined) parts.push(`${item.score} points`);
  if (item.by) parts.push(`by ${item.by}`);
  if (item.descendants !== undefined) parts.push(`${item.descendants} comments`);

  const hnLink = `https://news.ycombinator.com/item?id=${item.id}`;
  // If the item links externally, include the discussion link
  if (item.url && !item.url.includes("news.ycombinator.com")) {
    parts.push(`discuss: ${hnLink}`);
  }

  return parts.join(" | ");
}

const adapter: Adapter = {
  name: "hackernews",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const feed = (config.params?.feed as string) ?? (config.params?.stories as string) ?? "top";
    const limit = Math.min((config.params?.limit as number) ?? 30, 200);
    const minScore = (config.params?.min_score as number) ?? 0;

    // Resolve feed type, supporting legacy "stories" param and aliases
    let feedType: FeedType;
    const feedLower = feed.toLowerCase();
    if (feedLower in FEED_ENDPOINTS) {
      feedType = feedLower as FeedType;
    } else if (feedLower === "newest" || feedLower === "recent") {
      feedType = "new";
    } else if (feedLower === "front" || feedLower === "frontpage") {
      feedType = "top";
    } else if (feedLower === "askhn" || feedLower === "ask_hn") {
      feedType = "ask";
    } else if (feedLower === "showhn" || feedLower === "show_hn") {
      feedType = "show";
    } else if (feedLower === "jobs") {
      feedType = "job";
    } else {
      feedType = "top";
    }

    const endpoint = FEED_ENDPOINTS[feedType];

    try {
      const res = await fetch(`${HN_API}/${endpoint}.json`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        throw new Error(`hackernews: failed to fetch ${endpoint}: ${res.status}`);
      }
      const ids: number[] = await res.json();

      // Fetch more items than needed if we're filtering by score,
      // since some may be below threshold
      const fetchCount = minScore > 0 ? Math.min(limit * 3, ids.length) : limit;
      const sliced = ids.slice(0, fetchCount);
      const items = await fetchInBatches(sliced);

      // Apply score filter
      const filtered = minScore > 0
        ? items.filter((item) => (item.score ?? 0) >= minScore)
        : items;

      // Respect limit after filtering
      const limited = filtered.slice(0, limit);

      return limited.map((item) => ({
        id: `hn:${item.id}`,
        title: item.title ?? "(untitled)",
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        source: `hackernews:${feedType}`,
        timestamp: item.time ? new Date(item.time * 1000) : new Date(),
        body: buildBody(item),
      }));
    } catch (err) {
      throw new Error(`hackernews: error fetching stories: ${errorMessage(err)}`);
    }
  },
};

export default adapter;
