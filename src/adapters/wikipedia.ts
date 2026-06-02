import { formatViews, joinBodyParts } from "./engagement";
import { fetchJson } from "./fetch";
import { stripHtml } from "./html";
import { sliceToLimit } from "../utils";
import { dedupeByKey } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

type Mode = "most_read" | "featured" | "on_this_day" | "news";

const VALID_MODES = new Set<Mode>(["most_read", "featured", "on_this_day", "news"]);

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

function buildBody(article: WikiMostReadArticle): string {
  return joinBodyParts(
    formatViews(article.views),
    article.description ?? article.extract?.slice(0, 150),
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
  return fetchJson<WikiFeaturedResponse>("wikipedia", url, "featured feed", {
    userAgent: "pace:feed-aggregator/1.0 (github.com/everlier/pace)",
  });
}

function extractMostRead(data: WikiFeaturedResponse, limit: number): ContentItem[] {
  const articles = data.mostread?.articles ?? [];
  return sliceToLimit(articles, limit).map((article) => ({
    id: `wikipedia:mostread:${article.title}`,
    title: article.title.replace(/_/g, " "),
    url: article.content_urls.desktop.page,
    source: "wikipedia:most_read",
    timestamp: new Date(),
    body: buildBody(article),
  }));
}

function extractFeatured(data: WikiFeaturedResponse): ContentItem[] {
  const tfa = data.tfa;
  if (!tfa) return [];
  return [
    {
      id: `wikipedia:tfa:${tfa.title}`,
      title: `Featured: ${tfa.title.replace(/_/g, " ")}`,
      url: tfa.content_urls.desktop.page,
      source: "wikipedia:featured",
      timestamp: new Date(),
      body: tfa.description ?? tfa.extract?.slice(0, 200) ?? "",
    },
  ];
}

function extractOnThisDay(data: WikiFeaturedResponse, limit: number): ContentItem[] {
  const events = data.onthisday ?? [];
  return sliceToLimit(events, limit).map((event) => {
    const page = event.pages?.[0];
    const url = page?.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/Portal:Current_events`;
    return {
      id: `wikipedia:otd:${event.year}:${stripHtml(event.text, { whitespace: "preserve" }).slice(0, 40)}`,
      title: `${event.year}: ${stripHtml(event.text, { whitespace: "preserve" })}`,
      url,
      source: "wikipedia:on_this_day",
      timestamp: new Date(),
      body: page?.description ?? "",
    };
  });
}

function extractNews(data: WikiFeaturedResponse, limit: number): ContentItem[] {
  const items = data.news ?? [];
  return sliceToLimit(items, limit).map((item, i) => {
    const link = item.links?.[0];
    const url = link?.content_urls?.desktop?.page ?? "https://en.wikipedia.org/wiki/Portal:Current_events";
    return {
      id: `wikipedia:news:${link?.title ?? `untitled-${i}`}`,
      title: stripHtml(item.story, { whitespace: "preserve" }),
      url,
      source: "wikipedia:news",
      timestamp: new Date(),
      body: link?.description ?? "",
    };
  });
}

function normalizeModeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/-/g, "_");
}

function parseModeToken(token: string): Mode | null {
  const normalized = normalizeModeToken(token);
  return VALID_MODES.has(normalized as Mode) ? (normalized as Mode) : null;
}

function resolveModes(config: AdapterConfig): Mode[] {
  const modesParam = config.params?.modes;
  const tokens: string[] = [];

  if (Array.isArray(modesParam)) {
    for (const entry of modesParam) {
      if (typeof entry === "string") tokens.push(entry);
    }
  } else {
    const modeParam = (config.params?.mode as string) ?? "most_read";
    tokens.push(
      ...modeParam.split(",").map((part) => part.trim()).filter(Boolean),
    );
  }

  const resolved = tokens
    .map(parseModeToken)
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

const adapter: Adapter = {
  name: "wikipedia",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const languageRaw = (config.params?.language as string) ?? "en";
    const language = isValidLanguage(languageRaw) ? languageRaw : "en";
    const limit = Math.min((config.params?.limit as number) ?? 20, 50);

    const modes = resolveModes(config);

    const { year, month, day } = todayParts();
    const data = await fetchFeaturedFeed(language, year, month, day);

    if (modes.length === 1) {
      return extractForMode(data, modes[0], limit);
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
