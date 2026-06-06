import {
  formatAtHandle,
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
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  resolveAliasedOption,
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
    formatBy(formatAtHandle(article.user.username)),
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

type DevToPeriod = 1 | 7 | 30 | 365;

const DEFAULT_PERIOD: DevToPeriod = 7;

const PERIOD_TYPES: Record<string, DevToPeriod> = {
  "1": 1,
  "7": 7,
  "30": 30,
  "365": 365,
};

const PERIOD_ALIASES: Record<string, DevToPeriod> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
  infinity: 365,
  all: 365,
};

function bucketPeriodDays(n: number): DevToPeriod {
  if (n <= 1) return 1;
  if (n <= 7) return 7;
  if (n <= 30) return 30;
  return 365;
}

/** Map configured top param (days or alias) to Dev.to API top query value. */
export function resolveDevToPeriod(top: unknown): DevToPeriod {
  if (typeof top === "number") {
    return bucketPeriodDays(top);
  }
  if (typeof top === "string") {
    return resolveAliasedOption(top, PERIOD_TYPES, PERIOD_ALIASES, DEFAULT_PERIOD);
  }
  return DEFAULT_PERIOD;
}

const adapter: Adapter = {
  name: "devto",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const tags = normalizeParamStringList(config.params, "tags");
    const username = normalizeParamString(config.params, "username");
    const perPage = clampAdapterLimit(
      config.params?.per_page ?? config.params?.limit,
      20,
      30,
    );
    const minReactions = normalizeNonNegativeNumber(config.params?.min_reactions);
    const top = resolveDevToPeriod(config.params?.top);

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
