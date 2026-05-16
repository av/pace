import type { Adapter, AdapterConfig, ContentItem } from "./types";

const HN_API = "https://hacker-news.firebaseio.com/v0";
const BATCH_SIZE = 10;

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  time?: number;
  type?: string;
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    const res = await fetch(`${HN_API}/item/${id}.json`, { signal: AbortSignal.timeout(10000) });
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

const adapter: Adapter = {
  name: "hackernews",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const stories = (config.params?.stories as string) ?? "top";
    const limit = Math.min((config.params?.limit as number) ?? 30, 100);
    const validTypes = ["top", "new", "best"];
    const storyType = validTypes.includes(stories) ? stories : "top";

    try {
      const res = await fetch(`${HN_API}/${storyType}stories.json`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        console.warn(`hackernews: failed to fetch ${storyType}stories: ${res.status}`);
        return [];
      }
      const ids: number[] = await res.json();
      const sliced = ids.slice(0, limit);
      const items = await fetchInBatches(sliced);

      return items.map((item) => ({
        id: `hn:${item.id}`,
        title: item.title ?? "(untitled)",
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        source: "hackernews",
        timestamp: item.time ? new Date(item.time * 1000) : new Date(),
        body: item.score !== undefined ? `score: ${item.score}` : undefined,
      }));
    } catch (err) {
      console.warn("hackernews: error fetching stories:", err);
      return [];
    }
  },
};

export default adapter;
