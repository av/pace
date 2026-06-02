import {
  formatBy,
  formatComments,
  formatReactions,
  formatReadingTime,
  formatTags,
  joinBodyParts,
} from "./engagement";
import { fetchJson } from "./fetch";
import { dedupeByKey, fetchAndConcat, sliceToLimit } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

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
  return joinBodyParts(
    formatReactions(article.positive_reactions_count),
    formatComments(article.comments_count),
    formatReadingTime(article.reading_time_minutes),
    formatBy(`@${article.user.username}`),
    formatTags(article.tag_list),
    article.cover_image ? `cover: ${article.cover_image}` : undefined,
  );
}

async function fetchDevToArticles(
  query: Record<string, string | number>,
  context: string,
): Promise<DevToArticle[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    params.set(k, String(v));
  }
  const url = `${DEVTO_API}?${params.toString()}`;

  return fetchJson<DevToArticle[]>("devto", url, context, {
    userAgent: "pace:feed-aggregator/1.0",
    accept: "application/json",
  });
}

function resolvePeriod(top: unknown): number {
  if (typeof top === "number") {
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

    if (username) {
      const articles = await fetchDevToArticles(
        { username, per_page: limit },
        `user "${username}"`,
      );
      allArticles.push(...articles);
    }

    if (tags.length > 0) {
      allArticles.push(
        ...(await fetchAndConcat(tags, (tag) =>
          fetchDevToArticles(
            { tag, top: String(top), per_page: limit },
            `tag "${tag}"`,
          ),
        )),
      );
    }

    const deduped = dedupeByKey(allArticles, (article) => article.id);

    const filtered =
      minReactions > 0
        ? deduped.filter(
            (a) => a.positive_reactions_count >= minReactions,
          )
        : deduped;

    filtered.sort(
      (a, b) => b.positive_reactions_count - a.positive_reactions_count,
    );

    const limited = sliceToLimit(filtered, limit);

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
