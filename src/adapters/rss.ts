import { XMLParser } from "fast-xml-parser";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function extractItems(parsed: any): any[] {
  // RSS 2.0
  if (parsed?.rss?.channel?.item) {
    const items = parsed.rss.channel.item;
    return Array.isArray(items) ? items : [items];
  }
  // Atom
  if (parsed?.feed?.entry) {
    const entries = parsed.feed.entry;
    return Array.isArray(entries) ? entries : [entries];
  }
  return [];
}

function extractFeedTitle(parsed: any, url: string): string {
  if (parsed?.rss?.channel?.title) return parsed.rss.channel.title;
  if (parsed?.feed?.title) {
    const t = parsed.feed.title;
    return typeof t === "string" ? t : t["#text"] ?? url;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function parseItem(raw: any, source: string): ContentItem {
  // title
  const title = raw.title?.["#text"] ?? raw.title ?? "(untitled)";

  // link — RSS uses <link>, Atom uses <link href="...">
  let link = "";
  if (typeof raw.link === "string") {
    link = raw.link;
  } else if (raw.link?.["@_href"]) {
    link = raw.link["@_href"];
  } else if (Array.isArray(raw.link)) {
    const alt = raw.link.find((l: any) => l["@_rel"] === "alternate");
    link = alt?.["@_href"] ?? raw.link[0]?.["@_href"] ?? "";
  }

  // timestamp — RSS uses pubDate, Atom uses updated or published
  const dateStr = raw.pubDate ?? raw.updated ?? raw.published ?? "";
  const timestamp = dateStr ? new Date(dateStr) : new Date();

  // body — RSS uses description, Atom uses summary or content
  const body = raw.description ?? raw.summary ?? raw.content?.["#text"] ?? raw.content ?? undefined;

  return {
    id: `rss:${link || title}`,
    title: String(title),
    url: String(link),
    source,
    timestamp,
    body: body ? String(body) : undefined,
  };
}

async function fetchFeed(url: string): Promise<ContentItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "pace/1.0" },
    });
    if (!res.ok) {
      console.warn(`rss: failed to fetch ${url}: ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const source = extractFeedTitle(parsed, url);
    const items = extractItems(parsed);
    return items.map((item) => parseItem(item, source));
  } catch (err) {
    console.warn(`rss: error fetching ${url}:`, err);
    return [];
  }
}

const adapter: Adapter = {
  name: "rss",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const urls = (config.params.urls as string[]) ?? [];
    if (urls.length === 0) return [];

    const results = await Promise.all(urls.map(fetchFeed));
    return results.flat();
  },
};

export default adapter;
