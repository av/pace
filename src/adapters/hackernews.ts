import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
} from "./engagement";
import { joinTitle } from "./title";

import { parseUnixEpochSeconds } from "./dates";
import { fetchJson, HN_ITEM_FETCH_TIMEOUT_MS, tryOptionalFetch } from "./fetch";
import { fetchAllBatched } from "./merge";
import { decodeNumericFeedTitleOptional } from "./html";
import {
  normalizeNonNegativeNumber,
  normalizeParamStringFirst,
  clampAdapterLimit,
  resolveAliasedOption,
} from "../utils";
import { finalizeFetchedItems } from "./merge";
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

const FEED_TYPES: Record<string, FeedType> = {
  top: "top",
  new: "new",
  best: "best",
  ask: "ask",
  show: "show",
  job: "job",
};

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
  return resolveAliasedOption(feed, FEED_TYPES, FEED_ALIASES, "top");
}

async function fetchItem(id: number): Promise<HNItem | null> {
  const subpath = `item/${id}.json`;
  return tryOptionalFetch("hackernews", `failed to fetch item ${id}`, () =>
    fetchJson<HNItem>("hackernews", `${HN_API}/${subpath}`, subpath, {
      timeoutMs: HN_ITEM_FETCH_TIMEOUT_MS,
    }),
  );
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

    const overfetchForMinScore =
      minScore > 0 ? Math.min(limit * 3, ids.length) : limit;
    const sliced = ids.slice(0, overfetchForMinScore);
    const items = (
      await fetchAllBatched(sliced, BATCH_SIZE, fetchItem)
    ).filter((item): item is HNItem => item !== null);

    const limited = finalizeFetchedItems(items, {
      limit,
      minScore,
      scoreOf: (item) => item.score ?? 0,
    });

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
