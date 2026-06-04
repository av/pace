import {
  formatBy,
  formatComments,
  formatCover,
  formatReactions,
  formatReadingTime,
  formatTags,
} from "./engagement";
import { joinTitle } from "./title";

import { fetchJson } from "./fetch";
import { decodeNumericFeedTitle } from "./html";
import {
  normalizeNonNegativeNumber,
  normalizeOptionalString,
  clampAdapterLimit,
  normalizeStringList,
  sliceToLimit,
} from "../utils";
import { dedupeByKey, fetchAndConcat } from "./merge";
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
  return joinTitle(
    formatReactions(article.positive_reactions_count),
    formatComments(article.comments_count),
    formatReadingTime(article.reading_time_minutes),
    formatBy(`@${article.user.username}`),
    formatTags(article.tag_list),
    formatCover(article.cover_image),
  );
}

async function fetchDevToArticles(
  query: Record<string, string | number>,
  context: string,
): Promise<DevToArticle[]> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    params.set(k, String(v));
  }
  const url = `${DEVTO_API}?${params.toString()}`;

  return fetchJson<DevToArticle[]>("devto", url, context, {
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
    const tags = normalizeStringList((config.params?.tags as string[]) ?? []);
    const username = normalizeOptionalString(
      config.params?.username as string | undefined,
    );
    const perPage = clampAdapterLimit(
      config.params?.per_page ?? config.params?.limit,
      20,
      30,
    );
    const minReactions = normalizeNonNegativeNumber(config.params?.min_reactions);
    const top = resolvePeriod(config.params?.top);

    if (tags.length === 0 && !username) {
      console.warn("devto: no tags or username configured");
      return [];
    }

    const allArticles: DevToArticle[] = [];

    if (username) {
      const articles = await fetchDevToArticles(
        { username, per_page: perPage },
        `user "${username}"`,
      );
      allArticles.push(...articles);
    }

    if (tags.length > 0) {
      allArticles.push(
        ...(await fetchAndConcat(tags, (tag) =>
          fetchDevToArticles(
            { tag, top: String(top), per_page: perPage },
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

    const limited = sliceToLimit(filtered, perPage);

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
      title: decodeNumericFeedTitle(article.title),
      url: article.url,
      source: sourceLabel,
      timestamp: new Date(article.published_at),
      body: buildBody(article),
    }));
  },
};

export default adapter;
