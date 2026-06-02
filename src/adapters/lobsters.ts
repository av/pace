import {
  formatBy,
  formatComments,
  formatDiscuss,
  formatPoints,
  formatTags,
  joinBodyParts,
} from "./engagement";
import { fetchJson } from "./fetch";
import { sliceToLimit } from "../utils";
import { dedupeByKey, fetchAndConcat, sortByCreatedAtDesc } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const LOBSTERS_BASE = "https://lobste.rs";

type FeedType = "hottest" | "newest" | "active";

const VALID_FEEDS = new Set<FeedType>(["hottest", "newest", "active"]);

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
  return joinBodyParts(
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
    const feed = (config.params?.feed as string) ?? "hottest";
    const limit = Math.min((config.params?.limit as number) ?? 25, 100);
    const minScore = (config.params?.min_score as number) ?? 0;
    const tags = (config.params?.tags as string[]) ?? [];

    let feedType: FeedType;
    const feedLower = feed.toLowerCase();
    if (VALID_FEEDS.has(feedLower as FeedType)) {
      feedType = feedLower as FeedType;
    } else if (feedLower === "hot" || feedLower === "front") {
      feedType = "hottest";
    } else if (feedLower === "new" || feedLower === "recent") {
      feedType = "newest";
    } else {
      feedType = "hottest";
    }

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
      title: item.title,
      url: item.url || item.comments_url,
      source: tags.length > 0 ? `lobsters:${tags.join("+")}` : `lobsters:${feedType}`,
      timestamp: new Date(item.created_at),
      body: buildBody(item),
    }));
  },
};

export default adapter;
