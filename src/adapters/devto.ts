import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

const DEVTO_API = "https://dev.to/api/articles";

interface DevToArticle {
  id: number;
  title: string;
  url: string;
  description: string;
  published_at: string;
  reading_time_minutes: number;
  positive_reactions_count: number;
  comments_count: number;
  user: {
    username: string;
    name: string;
  };
  tag_list: string[];
  cover_image: string | null;
}

function buildBody(article: DevToArticle): string {
  const parts: string[] = [];

  parts.push(`${article.positive_reactions_count} reactions`);
  parts.push(`${article.comments_count} comments`);
  parts.push(`${article.reading_time_minutes} min read`);
  parts.push(`by @${article.user.username}`);

  if (article.tag_list.length > 0) {
    parts.push(`tags: ${article.tag_list.join(", ")}`);
  }

  if (article.cover_image) {
    parts.push(`cover: ${article.cover_image}`);
  }

  return parts.join(" | ");
}

async function fetchArticlesByTag(
  tag: string,
  top: number,
  limit: number,
): Promise<DevToArticle[]> {
  const params = new URLSearchParams({
    tag,
    top: String(top),
    per_page: String(limit),
  });

  const url = `${DEVTO_API}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "pace:feed-aggregator/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`devto: failed to fetch tag "${tag}": ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    throw new Error(`devto: error fetching tag "${tag}": ${errorMessage(err)}`);
  }
}

async function fetchArticlesByUsername(
  username: string,
  limit: number,
): Promise<DevToArticle[]> {
  const params = new URLSearchParams({
    username,
    per_page: String(limit),
  });

  const url = `${DEVTO_API}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "pace:feed-aggregator/1.0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`devto: failed to fetch user "${username}": ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    throw new Error(`devto: error fetching user "${username}": ${errorMessage(err)}`);
  }
}

const VALID_PERIODS = new Set([1, 7, 30, 365, Infinity]);

function resolvePeriod(top: unknown): number {
  if (typeof top === "number") {
    // Map to nearest valid period
    if (top <= 1) return 1;
    if (top <= 7) return 7;
    if (top <= 30) return 30;
    if (top <= 365) return 365;
    return 365; // "infinity" isn't a valid API param, use largest
  }
  if (typeof top === "string") {
    const lower = top.toLowerCase();
    if (lower === "day" || lower === "1") return 1;
    if (lower === "week" || lower === "7") return 7;
    if (lower === "month" || lower === "30") return 30;
    if (lower === "year" || lower === "365") return 365;
    if (lower === "infinity" || lower === "all") return 365;
  }
  return 7; // default: week
}

const adapter: Adapter = {
  name: "devto",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const tags = (config.params?.tags as string[]) ?? [];
    const username = (config.params?.username as string) ?? "";
    const limit = Math.min((config.params?.limit as number) ?? 20, 30);
    const minReactions = (config.params?.min_reactions as number) ?? 0;
    const top = resolvePeriod(config.params?.top);

    if (tags.length === 0 && !username) {
      console.warn("devto: no tags or username configured");
      return [];
    }

    const allArticles: DevToArticle[] = [];

    // Fetch by username if specified
    if (username) {
      const articles = await fetchArticlesByUsername(username, limit);
      allArticles.push(...articles);
    }

    // Fetch each tag separately and merge
    for (const tag of tags) {
      const articles = await fetchArticlesByTag(tag, top, limit);
      allArticles.push(...articles);
    }

    // Deduplicate by article ID (articles can appear in multiple tags)
    const seen = new Set<number>();
    const deduped = allArticles.filter((article) => {
      if (seen.has(article.id)) return false;
      seen.add(article.id);
      return true;
    });

    // Apply minimum reactions filter
    const filtered =
      minReactions > 0
        ? deduped.filter(
            (a) => a.positive_reactions_count >= minReactions,
          )
        : deduped;

    // Sort by reactions descending
    filtered.sort(
      (a, b) => b.positive_reactions_count - a.positive_reactions_count,
    );

    // Apply limit
    const limited = filtered.slice(0, limit);

    // Build source label
    let sourceLabel: string;
    if (username) {
      sourceLabel = `devto:${username}`;
    } else if (tags.length === 1) {
      sourceLabel = `devto:${tags[0]}`;
    } else {
      sourceLabel = `devto:${tags.join("+")}`;
    }

    return limited.map((article) => ({
      id: `devto:${article.id}`,
      title: article.title,
      url: article.url,
      source: sourceLabel,
      timestamp: new Date(article.published_at),
      body: buildBody(article),
    }));
  },
};

export default adapter;
