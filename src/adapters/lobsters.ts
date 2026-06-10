import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
  formatTags,
} from "./engagement";
import { joinTitle } from "./title";

import { fetchJson } from "./fetch";
import { decodeNumericFeedTitleOptional } from "./html";
import {
  normalizeNonNegativeNumber,
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  createAliasedResolver,
  compareIsoTimestamp,
} from "../utils";
import { mapToContentItems } from "./content-item";
import { aggregateSequentialFeeds } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const LOBSTERS_BASE = "https://lobste.rs";

type FeedType = "hottest" | "newest" | "active";

/** Build lobsters source label from tags or feed type. */
export function lobstersSourceLabel(
  tags: readonly string[],
  feedType: string,
): string {
  return tags.length > 0 ? `lobsters:${tags.join("+")}` : `lobsters:${feedType}`;
}

/** Map configured feed string (canonical name or alias) to Lobsters feed type. Unknown → hottest. */
export const resolveLobstersFeedType = createAliasedResolver<FeedType>({
  types: ["hottest", "newest", "active"],
  aliases: { hot: "hottest", front: "hottest", new: "newest", recent: "newest" },
  fallback: "hottest",
});

interface LobstersItem {
  short_id: string;
  short_id_url: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  comments_url: string;
  submitter_user: string;
  created_at: string;
  tags: string[];
  description?: string;
}

function lobstersSortComparator(
  feedType: FeedType,
): (a: LobstersItem, b: LobstersItem) => number {
  if (feedType === "hottest") {
    return (a, b) => b.score - a.score;
  }
  if (feedType === "newest") {
    return (a, b) => compareIsoTimestamp(a.created_at, b.created_at, "desc");
  }
  return (a, b) => b.comment_count - a.comment_count;
}

function buildBody(item: LobstersItem): string {
  return joinTitle(
    formatPoints(item.score),
    formatBy(item.submitter_user),
    formatComments(item.comment_count),
    formatTags(item.tags),
    item.url && !item.url.includes("lobste.rs")
      ? formatDiscuss(item.comments_url)
      : undefined,
  );
}

const adapter: Adapter = {
  name: "lobsters",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const feedType = resolveLobstersFeedType(
      normalizeParamString(config.params, "feed", "hottest"),
    );
    const limit = clampAdapterLimit(config.params?.limit, 25, 100);
    const minScore = normalizeNonNegativeNumber(config.params?.min_score);
    const tags = normalizeParamStringList(config.params, "tags");

    const keys = tags.length === 0 ? [feedType] : tags;
    const isMultiSource = tags.length > 0;

    const finalizeOptions = {
      limit,
      minScore,
      scoreOf: (item: LobstersItem) => item.score,
      ...(isMultiSource
        ? {
            dedupeKey: (item: LobstersItem) => item.short_id,
            sort: lobstersSortComparator(feedType),
          }
        : {}),
    };

    const fetchOne = (key: string) =>
      isMultiSource
        ? fetchJson<LobstersItem[]>(
            "lobsters",
            `${LOBSTERS_BASE}/t/${encodeURIComponent(key)}.json`,
            `tag ${key}`,
          )
        : fetchJson<LobstersItem[]>(
            "lobsters",
            `${LOBSTERS_BASE}/${key}.json`,
            key,
          );

    const limited = await aggregateSequentialFeeds(keys, fetchOne, finalizeOptions);

    return mapToContentItems(
      limited,
      lobstersSourceLabel(tags, feedType),
      (item) => ({
      id: `lobsters:${item.short_id}`,
      title: decodeNumericFeedTitleOptional(item.title),
      url: item.url || item.comments_url,
      timestamp: new Date(item.created_at),
      body: buildBody(item),
    }),
    );
  },
};

export default adapter;
