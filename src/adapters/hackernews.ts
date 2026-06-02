import { parseUnixEpochSeconds } from "./dates";
import { sliceToLimit } from "./merge";
import { fetchWithTimeout } from "./fetch";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

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
  descendants?: number;
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

async function fetchHN<T>(subpath: string, timeout: number, errorContext?: string): Promise<T> {
  const res = await fetchWithTimeout(`${HN_API}/${subpath}`, { timeoutMs: timeout });
  if (!res.ok) {
    const ctx = errorContext ?? subpath;
    throw new Error(`hackernews: failed to fetch ${ctx}: ${errorMessage({ message: String(res.status) })}`);
  }
  return (await res.json()) as T;
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    return await fetchHN<HNItem>(`item/${id}.json`, 10000);
  } catch (err) {
    console.warn(`hackernews: failed to fetch item ${id}: ${errorMessage(err)}`);
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

    let ids: number[];
    try {
      const res = await fetchWithTimeout(`${HN_API}/${endpoint}.json`, { timeoutMs: 15000 });
      if (!res.ok) {
        throw new Error(
          `hackernews: failed to fetch ${endpoint}: ${errorMessage({ message: String(res.status) })}`,
        );
      }
      ids = (await res.json()) as number[];
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("hackernews: failed to fetch")) {
        throw err;
      }
      throw new Error(`hackernews: error fetching stories: ${errorMessage(err)}`);
    }

    // Fetch more items than needed if we're filtering by score,
    // since some may be below threshold
    const fetchCount = minScore > 0 ? Math.min(limit * 3, ids.length) : limit;
    const sliced = ids.slice(0, fetchCount);
    const items = await fetchInBatches(sliced);

    const filtered = minScore > 0
      ? items.filter((item) => (item.score ?? 0) >= minScore)
      : items;

    const limited = sliceToLimit(filtered, limit);

    return limited.map((item) => ({
      id: `hn:${item.id}`,
      title: item.title ?? "(untitled)",
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      source: `hackernews:${feedType}`,
      timestamp: parseUnixEpochSeconds(item.time),
      body: buildBody(item),
    }));
  },
};

export default adapter;
