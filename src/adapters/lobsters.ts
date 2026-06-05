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
  sliceToLimit,
} from "../utils";
import { dedupeByKey, fetchAndConcat, sortByCreatedAtDesc } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const LOBSTERS_BASE = "https://lobste.rs";

type FeedType = "hottest" | "newest" | "active";

const FEED_TYPES: Record<string, FeedType> = {
  hottest: "hottest",
  newest: "newest",
  active: "active",
};

const FEED_ALIASES: Record<string, FeedType> = {
  hot: "hottest",
  front: "hottest",
  new: "newest",
  recent: "newest",
};

/** Map configured feed string (canonical name or alias) to Lobsters feed type. Unknown → hottest. */
export function resolveLobstersFeedType(feed: string): FeedType {
  const lower = feed.toLowerCase();
  if (lower in FEED_TYPES) return FEED_TYPES[lower];
  return FEED_ALIASES[lower] ?? "hottest";
}

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

    let items: LobstersItem[] = [];

    if (tags.length > 0) {
      items = await fetchAndConcat(tags, (tag) => {
        const tagUrl = `${LOBSTERS_BASE}/t/${encodeURIComponent(tag)}.json`;
        return fetchJson<LobstersItem[]>("lobsters", tagUrl, `tag ${tag}`);
      });

      items = dedupeByKey(items, (item) => item.short_id);

      if (feedType === "hottest") {
        items.sort((a, b) => b.score - a.score);
      } else if (feedType === "newest") {
        sortByCreatedAtDesc(items);
      } else {
        items.sort((a, b) => b.comment_count - a.comment_count);
      }
    } else {
      const feedUrl = `${LOBSTERS_BASE}/${feedType}.json`;
      items = await fetchJson<LobstersItem[]>("lobsters", feedUrl, feedType);
    }

    if (minScore > 0) {
      items = items.filter((item) => item.score >= minScore);
    }

    const limited = sliceToLimit(items, limit);

    return limited.map((item) => ({
      id: `lobsters:${item.short_id}`,
      title: decodeNumericFeedTitleOptional(item.title),
      url: item.url || item.comments_url,
      source: tags.length > 0 ? `lobsters:${tags.join("+")}` : `lobsters:${feedType}`,
      timestamp: new Date(item.created_at),
      body: buildBody(item),
    }));
  },
};

export default adapter;
