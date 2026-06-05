import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
} from "./engagement";
import { joinTitle } from "./title";

import { parseUnixEpochSeconds } from "./dates";
import { fetchJson, HN_ITEM_FETCH_TIMEOUT_MS, warnOptionalFetchFailure } from "./fetch";
import { decodeNumericFeedTitleOptional } from "./html";
import {
  normalizeNonNegativeNumber,
  normalizeParamStringFirst,
  clampAdapterLimit,
  sliceToLimit,
} from "../utils";
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

const FEED_ALIASES: Record<string, FeedType> = {
  newest: "new",
  recent: "new",
  front: "top",
  frontpage: "top",
  askhn: "ask",
  ask_hn: "ask",
  showhn: "show",
  show_hn: "show",
  jobs: "job",
};

/** Map configured feed string (canonical name or alias) to HN feed type. Unknown → top. */
export function resolveHnFeedType(feed: string): FeedType {
  const lower = feed.toLowerCase();
  if (lower in FEED_ENDPOINTS) return lower as FeedType;
  return FEED_ALIASES[lower] ?? "top";
}

async function fetchItem(id: number): Promise<HNItem | null> {
  const subpath = `item/${id}.json`;
  try {
    return await fetchJson<HNItem>("hackernews", `${HN_API}/${subpath}`, subpath, {
      timeoutMs: HN_ITEM_FETCH_TIMEOUT_MS,
    });
  } catch (err) {
    warnOptionalFetchFailure("hackernews", err, `failed to fetch item ${id}`);
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
  return joinTitle(
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
    const feed =
      normalizeParamStringFirst(
        config.params,
        ["type", "feed", "stories"],
        "top",
      ) ?? "top";
    const limit = clampAdapterLimit(config.params?.limit, 30, 200);
    const minScore = normalizeNonNegativeNumber(config.params?.min_score);

    const feedType = resolveHnFeedType(feed);

    const endpoint = FEED_ENDPOINTS[feedType];

    const ids = await fetchJson<number[]>(
      "hackernews",
      `${HN_API}/${endpoint}.json`,
      endpoint,
    );

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
