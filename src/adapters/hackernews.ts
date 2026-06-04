import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
  joinBodyParts,
} from "./engagement";
import { parseUnixEpochSeconds } from "./dates";
import { fetchJson, HN_ITEM_FETCH_TIMEOUT_MS } from "./fetch";
import { decodeNumericFeedTitleOptional } from "./html";
import {
  normalizeNonNegativeNumber,
  normalizeOptionalString,
  normalizePositiveInteger,
  sliceToLimit,
} from "../utils";
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
  const ctx = errorContext ?? subpath;
  return fetchJson<T>("hackernews", `${HN_API}/${subpath}`, ctx, { timeoutMs: timeout });
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    return await fetchHN<HNItem>(`item/${id}.json`, HN_ITEM_FETCH_TIMEOUT_MS);
  } catch (err) {
    const msg = errorMessage(err);
    console.warn(
      msg.startsWith("hackernews:")
        ? msg
        : `hackernews: failed to fetch item ${id}: ${msg}`,
    );
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
  const hnLink = `https://news.ycombinator.com/item?id=${item.id}`;
  return joinBodyParts(
    item.score !== undefined ? formatPoints(item.score) : undefined,
    item.by ? formatBy(item.by) : undefined,
    item.descendants !== undefined ? formatComments(item.descendants) : undefined,
    item.url && !item.url.includes("news.ycombinator.com")
      ? formatDiscuss(hnLink)
      : undefined,
  );
}

const adapter: Adapter = {
  name: "hackernews",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const feedRaw =
      config.params?.type ?? config.params?.feed ?? config.params?.stories;
    const feed =
      (typeof feedRaw === "string"
        ? normalizeOptionalString(feedRaw)
        : undefined) ?? "top";
    const limit = Math.min(normalizePositiveInteger(config.params?.limit, 30), 200);
    const minScore = normalizeNonNegativeNumber(config.params?.min_score);

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
      ids = await fetchJson<number[]>("hackernews", `${HN_API}/${endpoint}.json`, endpoint);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("hackernews: failed to fetch")) {
        throw err;
      }
      if (err instanceof Error && err.message.startsWith("hackernews: error fetching")) {
        const detail = err.message.replace(/^hackernews: error fetching [^:]+: /, "");
        throw new Error(`hackernews: error fetching stories: ${detail}`);
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
      title: decodeNumericFeedTitleOptional(item.title),
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      source: `hackernews:${feedType}`,
      timestamp: parseUnixEpochSeconds(item.time),
      body: buildBody(item),
    }));
  },
};

export default adapter;
