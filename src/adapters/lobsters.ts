import { sliceToLimit } from "./dates";
import { fetchWithTimeout } from "./fetch";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

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
  const parts: string[] = [];
  parts.push(`${item.score} points`);
  parts.push(`by ${item.submitter_user}`);
  parts.push(`${item.comment_count} comments`);

  if (item.tags.length > 0) {
    parts.push(`tags: ${item.tags.join(", ")}`);
  }

  // Include discussion link for external URLs
  if (item.url && !item.url.includes("lobste.rs")) {
    parts.push(`discuss: ${item.comments_url}`);
  }

  return parts.join(" | ");
}

async function fetchLobstersJson(
  url: string,
  label: string,
): Promise<LobstersItem[]> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`lobsters: failed to fetch ${label}: ${errorMessage({ message: String(res.status) })}`);
  }
  return (await res.json()) as LobstersItem[];
}

const adapter: Adapter = {
  name: "lobsters",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const feed = (config.params?.feed as string) ?? "hottest";
    const limit = Math.min((config.params?.limit as number) ?? 25, 100);
    const minScore = (config.params?.min_score as number) ?? 0;
    const tags = (config.params?.tags as string[]) ?? [];

    // Resolve feed type
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

    try {
      let items: LobstersItem[] = [];

      if (tags.length > 0) {
        // Fetch tag-specific feeds and merge
        for (const tag of tags) {
          const tagUrl = `${LOBSTERS_BASE}/t/${encodeURIComponent(tag)}.json`;
          const tagItems = await fetchLobstersJson(tagUrl, `tag ${tag}`);
          items.push(...tagItems);
        }

        // Dedupe by short_id since items may appear in multiple tags
        const seen = new Set<string>();
        items = items.filter((item) => {
          if (seen.has(item.short_id)) return false;
          seen.add(item.short_id);
          return true;
        });

        // Sort merged tag results based on feed type preference
        if (feedType === "hottest") {
          items.sort((a, b) => b.score - a.score);
        } else if (feedType === "newest") {
          items.sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          );
        } else {
          // active: sort by comment count as proxy
          items.sort((a, b) => b.comment_count - a.comment_count);
        }
      } else {
        // Fetch the standard feed
        const feedUrl = `${LOBSTERS_BASE}/${feedType}.json`;
        items = await fetchLobstersJson(feedUrl, feedType);
      }

      // Apply score filter
      if (minScore > 0) {
        items = items.filter((item) => item.score >= minScore);
      }

      // Apply limit
      const limited = sliceToLimit(items, limit);

      return limited.map((item) => ({
        id: `lobsters:${item.short_id}`,
        title: item.title,
        url: item.url || item.comments_url,
        source: tags.length > 0 ? `lobsters:${tags.join("+")}` : `lobsters:${feedType}`,
        timestamp: new Date(item.created_at),
        body: buildBody(item),
      }));
    } catch (err) {
      throw new Error(`lobsters: error fetching stories: ${errorMessage(err)}`);
    }
  },
};

export default adapter;
