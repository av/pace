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

import { parseFeedDate } from "./dates";
import { warnEmptyConfig } from "./empty-config";
import { fetchJson, jsonObjectArrayOrEmpty } from "./fetch";
import { decodeNumericFeedTitle } from "./html";
import {
  normalizeNonNegativeNumber,
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  createAliasedResolver,
} from "../utils";
import { mapToContentItems } from "./content-item";
import { aggregateSequentialFeeds } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const DEVTO_API = "https://dev.to/api/articles";

const DEVTO_ARTICLE_REQUIRED_FIELDS = [
  "id",
  "title",
  "url",
  "user.username",
] as const;

interface DevToArticle {
  id: number;
  title: string;
  url: string;
  description?: string;
  published_at?: string;
  reading_time_minutes?: number;
  positive_reactions_count?: number;
  comments_count?: number;
  user: {
    username: string;
    name?: string;
  };
  tag_list?: string[];
  cover_image?: string | null;
}

function buildBody(article: DevToArticle): string {
  return joinTitle(
    formatReactions(article.positive_reactions_count ?? 0),
    formatComments(article.comments_count ?? 0),
    formatReadingTime(article.reading_time_minutes ?? 0),
    formatBy(formatAtHandle(article.user.username)),
    formatTags(article.tag_list ?? []),
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

  const json = await fetchJson<unknown>("devto", url, context, {
    accept: "application/json",
  });
  return jsonObjectArrayOrEmpty<DevToArticle>(
    "devto",
    json,
    context,
    DEVTO_ARTICLE_REQUIRED_FIELDS,
  );
}

type DevToPeriod = 1 | 7 | 30 | 365;

type DevToFetchKey = { kind: "user"; username: string } | { kind: "tag"; tag: string };

/** Ordered fetch keys for username and/or tag sources (username first when both set). */
export function devToFetchKeys(
  username: string | undefined,
  tags: readonly string[],
): DevToFetchKey[] {
  const keys: DevToFetchKey[] = [];
  if (username) keys.push({ kind: "user", username });
  for (const tag of tags) keys.push({ kind: "tag", tag });
  return keys;
}

/** Build devto source label from username and/or tag list. */
export function devtoSourceLabel(
  username: string | undefined,
  tags: readonly string[],
): string {
  if (username) return `devto:${username}`;
  if (tags.length === 1) return `devto:${tags[0]}`;
  return `devto:${tags.join("+")}`;
}

const DEFAULT_PERIOD: DevToPeriod = 7;

const resolveDevToPeriodToken = createAliasedResolver<DevToPeriod>({
  types: { "1": 1, "7": 7, "30": 30, "365": 365 },
  aliases: { day: 1, week: 7, month: 30, year: 365, infinity: 365, all: 365 },
  fallback: DEFAULT_PERIOD,
});

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
    return resolveDevToPeriodToken(top);
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
      return warnEmptyConfig("devto", "no tags or username configured");
    }

    const limited = await aggregateSequentialFeeds(
      devToFetchKeys(username, tags),
      async (key) => {
        if (key.kind === "user") {
          return fetchDevToArticles(
            { username: key.username, per_page: perPage },
            `user "${key.username}"`,
          );
        }
        return fetchDevToArticles(
          { tag: key.tag, top: String(top), per_page: perPage },
          `tag "${key.tag}"`,
        );
      },
      {
        limit: perPage,
        dedupeKey: (article) => article.id,
        minScore: minReactions,
        scoreOf: (article) => article.positive_reactions_count ?? 0,
        sort: (a, b) =>
          (b.positive_reactions_count ?? 0) - (a.positive_reactions_count ?? 0),
      },
    );

    return mapToContentItems(limited, devtoSourceLabel(username, tags), (article) => ({
      id: `devto:${article.id}`,
      title: decodeNumericFeedTitle(article.title),
      url: article.url,
      timestamp: parseFeedDate(article.published_at),
      body: buildBody(article),
    }));
  },
};

export default adapter;
