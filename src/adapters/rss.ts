import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  extractRssAtomItems,
  feedXmlParser,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { fetchText } from "./fetch";
import { decodeNumericFeedTitle, FEED_BODY_STRIP_OPTIONS, stripHtml } from "./html";
import { dedupeByKey } from "./merge";
import { extractHostname } from "../dedupe";
import { normalizeStringList } from "../utils";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

interface RssFeedItem extends FeedItemBodyFields {
  title?: XmlTextField;
  link?: AtomLinkField;
  pubDate?: string;
  updated?: string;
  published?: string;
}

interface RssFeedParsed {
  rss?: {
    channel?: {
      title?: XmlTextField;
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

function extractFeedTitle(parsed: RssFeedParsed, url: string): string {
  const title = extractFeedRootTitle(
    parsed?.rss?.channel?.title,
    parsed?.feed?.title,
  );
  if (title) return decodeNumericFeedTitle(title);
  return extractHostname(url, "rss") || url;
}

function parseItem(raw: RssFeedItem, source: string): ContentItem {
  const title = decodeNumericFeedTitle(extractFeedEntryTitle(raw.title));

  const link = extractAtomLink(raw.link);

  const dateStr = raw.pubDate ?? raw.updated ?? raw.published ?? "";
  const timestamp = parseFeedDate(dateStr);

  const rawBody = extractFeedItemBody(raw);
  const body = rawBody ? stripHtml(rawBody, FEED_BODY_STRIP_OPTIONS) : undefined;

  const resolvedUrl = link || undefined;

  const idSuffix = link || `${title}:${simpleHash(body ?? "")}`;

  return {
    id: `rss:${idSuffix}`,
    title,
    url: resolvedUrl ?? "",
    source,
    timestamp,
    body,
  };
}

async function fetchFeed(url: string): Promise<ContentItem[]> {
  const xml = await fetchText("rss", url, url, {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  });

  let parsed: RssFeedParsed;
  try {
    parsed = feedXmlParser.parse(xml) as RssFeedParsed;
  } catch (err) {
    throw new Error(`rss: error parsing xml from ${url}: ${errorMessage(err)}`);
  }
  const source = extractFeedTitle(parsed, url);
  const items = extractRssAtomItems(parsed);
  return items.map((item) => parseItem(item, source));
}

const adapter: Adapter = {
  name: "rss",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const urls = normalizeStringList((config.params?.urls as string[]) ?? []);
    if (urls.length === 0) {
      console.warn("rss: no urls configured");
      return [];
    }

    const results = await Promise.all(urls.map(fetchFeed));
    return dedupeByKey(results.flat(), (item) => item.url || item.id);
  },
};

export default adapter;
