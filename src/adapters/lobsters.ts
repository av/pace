import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
  formatTags,
} from "./engagement";
import { joinTitle } from "./title";

import { parseFeedDate } from "./dates";
import { fetchJson, jsonObjectArrayOrEmpty } from "./fetch";
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

const LOBSTERS_ITEM_REQUIRED_FIELDS = [
  "short_id",
  "title",
  "created_at",
] as const;

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
  short_id_url?: string;
  title: string;
  url?: string;
  score?: number;
  comment_count?: number;
  comments_url?: string;
  submitter_user?: string;
  created_at: string;
  tags?: string[];
  description?: string;
}

/** Canonical story URL fallback when the payload omits comments_url. */
function lobstersCommentsUrl(item: LobstersItem): string {
  return (
    item.comments_url ?? item.short_id_url ?? `${LOBSTERS_BASE}/s/${item.short_id}`
  );
}

function lobstersSortComparator(
  feedType: FeedType,
): (a: LobstersItem, b: LobstersItem) => number {
  if (feedType === "hottest") {
    return (a, b) => (b.score ?? 0) - (a.score ?? 0);
  }
  if (feedType === "newest") {
    return (a, b) => compareIsoTimestamp(a.created_at, b.created_at, "desc");
  }
  return (a, b) => (b.comment_count ?? 0) - (a.comment_count ?? 0);
}

function buildBody(item: LobstersItem): string {
  return joinTitle(
    formatPoints(item.score ?? 0),
    item.submitter_user ? formatBy(item.submitter_user) : undefined,
    formatComments(item.comment_count ?? 0),
    formatTags(item.tags ?? []),
    item.url && !item.url.includes("lobste.rs")
      ? formatDiscuss(lobstersCommentsUrl(item))
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
      scoreOf: (item: LobstersItem) => item.score ?? 0,
      ...(isMultiSource
        ? {
            dedupeKey: (item: LobstersItem) => item.short_id,
            sort: lobstersSortComparator(feedType),
          }
        : {}),
    };

    const fetchOne = async (key: string) => {
      const context = isMultiSource ? `tag ${key}` : key;
      const url = isMultiSource
        ? `${LOBSTERS_BASE}/t/${encodeURIComponent(key)}.json`
        : `${LOBSTERS_BASE}/${key}.json`;
      const json = await fetchJson<unknown>("lobsters", url, context);
      return jsonObjectArrayOrEmpty<LobstersItem>(
        "lobsters",
        json,
        context,
        LOBSTERS_ITEM_REQUIRED_FIELDS,
      );
    };

    const limited = await aggregateSequentialFeeds(keys, fetchOne, finalizeOptions);

    return mapToContentItems(
      limited,
      lobstersSourceLabel(tags, feedType),
      (item) => ({
      id: `lobsters:${item.short_id}`,
      title: decodeNumericFeedTitleOptional(item.title),
      url: item.url || lobstersCommentsUrl(item),
      timestamp: parseFeedDate(item.created_at),
      body: buildBody(item),
    }),
    );
  },
};

export default adapter;
