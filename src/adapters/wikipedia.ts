import {
  formatViews,
} from "./engagement";
import { joinTitle, truncateText } from "./title";

import { mapToContentItems } from "./content-item";
import { fetchJson } from "./fetch";
import { decodeNumericFeedTitle, stripHtml } from "./html";
import {
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  normalizeStringList,
  createAliasedResolver,
  sliceToLimit,
} from "../utils";
import { dedupeByKey } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

type Mode = "most_read" | "featured" | "on_this_day" | "news";

const resolveWikipediaModeToken = createAliasedResolver<Mode>({
  types: ["most_read", "featured", "on_this_day", "news"],
  aliases: {
    mostread: "most_read",
    popular: "most_read",
    tfa: "featured",
    onthisday: "on_this_day",
    otd: "on_this_day",
    current_events: "news",
    currentevents: "news",
  },
  fallback: null,
});

/** Build wikipedia source label from feed mode. */
export function wikipediaSourceLabel(mode: Mode): string {
  return `wikipedia:${mode}`;
}

/** Map configured mode string (canonical name or alias) to Wikipedia feed section. Unknown → null. */
export function resolveWikipediaMode(token: string): Mode | null {
  const normalized = token.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) return null;
  return resolveWikipediaModeToken(normalized);
}

interface WikiFeaturedResponse {
  tfa?: WikiArticle;
  mostread?: { articles: WikiMostReadArticle[] };
  onthisday?: WikiOnThisDay[];
  news?: WikiNewsItem[];
}

interface WikiArticle {
  title: string;
  extract: string;
  content_urls: { desktop: { page: string } };
  description?: string;
  timestamp?: string;
}

interface WikiMostReadArticle extends WikiArticle {
  views: number;
  rank: number;
}

interface WikiOnThisDay {
  text: string;
  year: number;
  pages: WikiArticle[];
}

interface WikiNewsItem {
  story: string;
  links: WikiArticle[];
}

function truncateWikiExtract(extract: string | undefined, max: number): string {
  if (!extract) return "";
  return truncateText(extract, max, { ellipsis: "...", inclusive: false, trim: false });
}

function buildBody(article: WikiMostReadArticle): string {
  return joinTitle(
    formatViews(article.views),
    article.description ?? truncateWikiExtract(article.extract, 150),
  );
}

function todayParts(): { year: string; month: string; day: string } {
  const now = new Date();
  return {
    year: String(now.getUTCFullYear()),
    month: String(now.getUTCMonth() + 1).padStart(2, "0"),
    day: String(now.getUTCDate()).padStart(2, "0"),
  };
}

function isValidLanguage(lang: string): boolean {
  return /^[a-z]{2,3}(-[a-z]{2,8})?$/.test(lang);
}

async function fetchFeaturedFeed(
  language: string,
  year: string,
  month: string,
  day: string,
): Promise<WikiFeaturedResponse> {
  const url = `https://${language}.wikipedia.org/api/rest_v1/feed/featured/${year}/${month}/${day}`;
  return fetchJson<WikiFeaturedResponse>("wikipedia", url, "featured feed");
}

function extractMostRead(data: WikiFeaturedResponse, limit: number): ContentItem[] {
  const articles = data.mostread?.articles ?? [];
  return mapToContentItems(
    sliceToLimit(articles, limit),
    wikipediaSourceLabel("most_read"),
    (article) => ({
      id: `wikipedia:mostread:${article.title}`,
      title: decodeNumericFeedTitle(article.title.replace(/_/g, " ")),
      url: article.content_urls.desktop.page,
      timestamp: new Date(),
      body: buildBody(article),
    }),
  );
}

function extractFeatured(data: WikiFeaturedResponse): ContentItem[] {
  const tfa = data.tfa;
  if (!tfa) return [];
  return mapToContentItems([tfa], wikipediaSourceLabel("featured"), (tfa) => ({
    id: `wikipedia:tfa:${tfa.title}`,
    title: `Featured: ${decodeNumericFeedTitle(tfa.title.replace(/_/g, " "))}`,
    url: tfa.content_urls.desktop.page,
    timestamp: new Date(),
    body: tfa.description ?? truncateWikiExtract(tfa.extract, 200),
  }));
}

function extractOnThisDay(data: WikiFeaturedResponse, limit: number): ContentItem[] {
  const events = data.onthisday ?? [];
  return mapToContentItems(
    sliceToLimit(events, limit),
    wikipediaSourceLabel("on_this_day"),
    (event) => {
      const page = event.pages?.[0];
      const text = decodeNumericFeedTitle(
        stripHtml(event.text, { whitespace: "preserve" }),
      );
      const url = page?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/Portal:Current_events`;
      return {
        id: `wikipedia:otd:${event.year}:${text.slice(0, 40)}`,
        title: `${event.year}: ${text}`,
        url,
        timestamp: new Date(),
        body: page?.description ?? "",
      };
    },
  );
}

function extractNews(data: WikiFeaturedResponse, limit: number): ContentItem[] {
  const items = data.news ?? [];
  return mapToContentItems(
    sliceToLimit(items, limit).map((item, index) => ({ item, index })),
    wikipediaSourceLabel("news"),
    ({ item, index }) => {
      const link = item.links?.[0];
      const url = link?.content_urls?.desktop?.page ?? "https://en.wikipedia.org/wiki/Portal:Current_events";
      return {
        id: `wikipedia:news:${link?.title ?? `untitled-${index}`}`,
        title: decodeNumericFeedTitle(
          stripHtml(item.story, { whitespace: "preserve" }),
        ),
        url,
        timestamp: new Date(),
        body: link?.description ?? "",
      };
    },
  );
}

function resolveModes(config: AdapterConfig): Mode[] {
  const params = config.params;
  const tokens = Array.isArray(params?.modes)
    ? normalizeParamStringList(params, "modes")
    : normalizeStringList(
        (normalizeParamString(params, "mode", "most_read") ?? "most_read").split(","),
      );

  const resolved = tokens
    .map(resolveWikipediaMode)
    .filter((mode): mode is Mode => mode !== null);

  return resolved.length > 0 ? resolved : ["most_read"];
}

function extractForMode(data: WikiFeaturedResponse, mode: Mode, limit: number): ContentItem[] {
  switch (mode) {
    case "most_read":
      return extractMostRead(data, limit);
    case "featured":
      return extractFeatured(data);
    case "on_this_day":
      return extractOnThisDay(data, limit);
    case "news":
      return extractNews(data, limit);
  }
}

function warnEmptyFeaturedSection(mode: "most_read" | "featured", language: string): void {
  if (mode === "most_read") {
    console.warn(
      `wikipedia: featured feed has no most_read articles (${language})`,
    );
  } else {
    console.warn(
      `wikipedia: featured feed has no article of the day (${language})`,
    );
  }
}

const adapter: Adapter = {
  name: "wikipedia",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const languageRaw = normalizeParamString(config.params, "language", "en");
    const language = isValidLanguage(languageRaw) ? languageRaw : "en";
    const limit = clampAdapterLimit(config.params?.limit, 20, 50);

    const modes = resolveModes(config);

    const { year, month, day } = todayParts();
    const data = await fetchFeaturedFeed(language, year, month, day);

    if (modes.length === 1) {
      const mode = modes[0];
      const items = extractForMode(data, mode, limit);
      if (
        items.length === 0 &&
        (mode === "most_read" || mode === "featured")
      ) {
        warnEmptyFeaturedSection(mode, language);
      }
      return items;
    }

    const merged: ContentItem[] = [];
    for (const mode of modes) {
      merged.push(...extractForMode(data, mode, limit));
    }

    return sliceToLimit(
      dedupeByKey(merged, (item) => item.url),
      limit,
    );
  },
};

export default adapter;
