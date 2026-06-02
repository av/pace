import { XMLParser } from "fast-xml-parser";
import { extractAtomLink, type AtomLinkField } from "./atom";
import { parseFeedDate } from "./dates";
import { fetchText } from "./fetch";
import { dedupeByKey } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

/** Parsed text node from fast-xml-parser. */
type XmlTextField = string | { "#text"?: string };

interface RssFeedItem {
  title?: XmlTextField;
  link?: AtomLinkField;
  pubDate?: string;
  updated?: string;
  published?: string;
  description?: XmlTextField;
  summary?: XmlTextField;
  content?: XmlTextField;
  "content:encoded"?: XmlTextField;
}

/** Parsed RSS 2.0 / Atom feed root from fast-xml-parser (attributeNamePrefix "@_"). */
interface RssFeedParsed {
  rss?: {
    channel?: {
      title?: string;
      item?: RssFeedItem | RssFeedItem[];
    };
  };
  feed?: {
    title?: XmlTextField;
    entry?: RssFeedItem | RssFeedItem[];
  };
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function extractText(raw: XmlTextField | undefined): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  const val = raw["#text"];
  return typeof val === "string" ? val : undefined;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

function extractItems(parsed: RssFeedParsed): RssFeedItem[] {
  if (parsed?.rss?.channel?.item) {
    const items = parsed.rss.channel.item;
    return Array.isArray(items) ? items : [items];
  }
  if (parsed?.feed?.entry) {
    const entries = parsed.feed.entry;
    return Array.isArray(entries) ? entries : [entries];
  }
  return [];
}

function extractFeedTitle(parsed: RssFeedParsed, url: string): string {
  if (parsed?.rss?.channel?.title) return parsed.rss.channel.title;
  if (parsed?.feed?.title) {
    const t = parsed.feed.title;
    return extractText(t) ?? url;
  }
  try {
    return new URL(url).hostname;
  } catch (err) {
    console.warn(`rss: extractFeedTitle could not parse url "${url}": ${errorMessage(err)}`);
    return url;
  }
}

function parseItem(raw: RssFeedItem, source: string): ContentItem {
  const title = extractText(raw.title) ?? "(untitled)";

  const link = extractAtomLink(raw.link);

  const dateStr = raw.pubDate ?? raw.updated ?? raw.published ?? "";
  const timestamp = parseFeedDate(dateStr);

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
  const xml = await fetchText("rss", url, url, {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  });

  let parsed: RssFeedParsed;
  try {
    parsed = parser.parse(xml) as RssFeedParsed;
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
    return dedupeByKey(results.flat(), (item) => item.url || item.id);
  },
};

export default adapter;
