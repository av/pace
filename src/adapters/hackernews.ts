import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
} from "./engagement";
import { joinTitle } from "./title";

import { parseUnixEpochSeconds } from "./dates";
import {
  fetchJson,
  HN_ITEM_FETCH_TIMEOUT_MS,
  jsonNumericArrayOrEmpty,
  jsonObjectOrNull,
  tryOptionalFetch,
} from "./fetch";
import { aggregateBatchedItems } from "./merge";
import { decodeNumericFeedTitleOptional } from "./html";
import {
  normalizeNonNegativeNumber,
  normalizeParamStringFirst,
  clampAdapterLimit,
  createAliasedResolver,
} from "../utils";
import { mapToContentItems } from "./content-item";
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

/** Build hackernews source label from feed type. */
export function hackernewsSourceLabel(feedType: FeedType): string {
  return `hackernews:${feedType}`;
}

const FEED_ENDPOINTS: Record<FeedType, string> = {
  top: "topstories",
  new: "newstories",
  best: "beststories",
  ask: "askstories",
  show: "showstories",
  job: "jobstories",
};

/** Map configured feed string (canonical name or alias) to HN feed type. Unknown → top. */
export const resolveHnFeedType = createAliasedResolver<FeedType>({
  types: ["top", "new", "best", "ask", "show", "job"],
  aliases: {
    newest: "new",
    recent: "new",
    front: "top",
    frontpage: "top",
    askhn: "ask",
    ask_hn: "ask",
    showhn: "show",
    show_hn: "show",
    jobs: "job",
  },
  fallback: "top",
});

async function fetchItem(id: number): Promise<HNItem | null> {
  const subpath = `item/${id}.json`;
  const raw = await tryOptionalFetch("hackernews", `failed to fetch item ${id}`, () =>
    fetchJson<unknown>("hackernews", `${HN_API}/${subpath}`, subpath, {
      timeoutMs: HN_ITEM_FETCH_TIMEOUT_MS,
    }),
  );
  if (raw == null) return null;
  return jsonObjectOrNull<HNItem>("hackernews", raw, subpath, ["id"]);
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

    const json = await fetchJson<unknown>(
      "hackernews",
      `${HN_API}/${endpoint}.json`,
      endpoint,
    );
    const ids = jsonNumericArrayOrEmpty("hackernews", json, endpoint);

    const overfetchForMinScore =
      minScore > 0 ? Math.min(limit * 3, ids.length) : limit;
    const sliced = ids.slice(0, overfetchForMinScore);
    const limited = await aggregateBatchedItems(
      sliced,
      BATCH_SIZE,
      fetchItem,
      {
        limit,
        minScore,
        scoreOf: (item) => item.score ?? 0,
      },
    );

    return mapToContentItems(limited, hackernewsSourceLabel(feedType), (item) => ({
      id: `hn:${item.id}`,
      title: decodeNumericFeedTitleOptional(item.title),
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      timestamp: parseUnixEpochSeconds(item.time),
      body: buildBody(item),
    }));
  },
};

export default adapter;
