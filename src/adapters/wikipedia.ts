import { fetchWithTimeout } from "./fetch";
import { stripHtml } from "./html";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

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

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m views`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k views`;
  return `${n} views`;
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
  const res = await fetchWithTimeout(url, {
    userAgent: "pace:feed-aggregator/1.0 (github.com/everlier/pace)",
  });
  if (!res.ok) {
    throw new Error(`wikipedia: failed to fetch featured feed: ${errorMessage({ message: `${res.status}` })}`);
  }
  return await res.json();
}

function extractMostRead(data: WikiFeaturedResponse, limit: number): ContentItem[] {
  const articles = data.mostread?.articles ?? [];
  return articles.slice(0, limit).map((article) => ({
    id: `wikipedia:mostread:${article.title}`,
    title: article.title.replace(/_/g, " "),
    url: article.content_urls.desktop.page,
    source: "wikipedia:most_read",
    timestamp: new Date(),
    body: [
      formatViews(article.views),
      article.description ?? article.extract?.slice(0, 150),
    ]
      .filter(Boolean)
      .join(" | "),
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
  return events.slice(0, limit).map((event) => {
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
  return items.slice(0, limit).map((item, i) => {
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

const adapter: Adapter = {
  name: "wikipedia",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const modeParam = (config.params?.mode as string) ?? "most_read";
    const languageRaw = (config.params?.language as string) ?? "en";
    const language = isValidLanguage(languageRaw) ? languageRaw : "en";
    const limit = Math.min((config.params?.limit as number) ?? 20, 50);

    const mode: Mode = VALID_MODES.has(modeParam as Mode)
      ? (modeParam as Mode)
      : "most_read";

    const { year, month, day } = todayParts();

    try {
      const data = await fetchFeaturedFeed(language, year, month, day);

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
    } catch (err) {
      throw new Error(`wikipedia: error fetching ${mode}: ${errorMessage(err)}`);
    }
  },
};

export default adapter;
