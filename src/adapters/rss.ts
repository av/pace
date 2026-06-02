import { XMLParser } from "fast-xml-parser";
import { extractAtomLink } from "./atom";
import { fetchText } from "./fetch";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";
// from "./types" errorMessage helper (verifier s7s for bugbash-iter11)

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Extracts plain string content from an RSS/Atom parsed field.
 * Fields may be a raw string or an object like { "#text": "value", ...attrs }.
 * Used to DRY the repeated typeof + ["#text"] access patterns.
 */
function extractText(raw: any): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && "#text" in raw) {
    const val = raw["#text"];
    return typeof val === "string" ? val : undefined;
  }
  return undefined;
}

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
    return extractText(t) ?? url;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function parseItem(raw: any, source: string): ContentItem {
  // title
  const title = extractText(raw.title) ?? "(untitled)";

  const link = extractAtomLink(raw.link);

  const dateStr = raw.pubDate ?? raw.updated ?? raw.published ?? "";
  const parsed = dateStr ? new Date(dateStr) : new Date();
  const timestamp = isNaN(parsed.getTime()) ? new Date() : parsed;

  const rawDesc = raw.description;
  const rawSummary = raw.summary;
  const rawContent = raw.content;
  const rawEncoded = raw["content:encoded"];
  const body =
    extractText(rawDesc) ??
    extractText(rawSummary) ??
    extractText(rawContent) ??
    extractText(rawEncoded) ??
    undefined;

  const resolvedUrl = link || undefined;

  const idSuffix = link || `${title}:${simpleHash(body ?? "")}`;

  return {
    id: `rss:${idSuffix}`,
    title: String(title),
    url: resolvedUrl ? String(resolvedUrl) : "",
    source,
    timestamp,
    body: body ? String(body) : undefined,
  };
}

async function fetchFeed(url: string): Promise<ContentItem[]> {
  const xml = await fetchText("rss", url);

  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new Error(`rss: error parsing xml from ${url}: ${errorMessage(err)}`);
  }
  const source = extractFeedTitle(parsed, url);
  const items = extractItems(parsed);
  return items.map((item) => parseItem(item, source));
}

const adapter: Adapter = {
  name: "rss",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const urls = (config.params?.urls as string[]) ?? [];
    if (urls.length === 0) return [];

    const results = await Promise.all(urls.map(fetchFeed));
    return results.flat();
  },
};

export default adapter;
