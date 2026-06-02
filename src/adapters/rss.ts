import { XMLParser } from "fast-xml-parser";
import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  extractRssAtomItems,
  FEED_XML_PARSER_OPTIONS,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { fetchText } from "./fetch";
import { decodeHtmlEntities, FEED_BODY_STRIP_OPTIONS, stripHtml } from "./html";
import { dedupeByKey } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

interface RssFeedItem extends FeedItemBodyFields {
  title?: XmlTextField;
  link?: AtomLinkField;
  pubDate?: string;
  updated?: string;
  published?: string;
}

/** Parsed RSS 2.0 / Atom feed root from fast-xml-parser (attributeNamePrefix "@_"). */
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

const parser = new XMLParser(FEED_XML_PARSER_OPTIONS);

function extractFeedTitle(parsed: RssFeedParsed, url: string): string {
  const title = extractFeedRootTitle(
    parsed?.rss?.channel?.title,
    parsed?.feed?.title,
  );
  if (title) return decodeHtmlEntities(title, { numeric: true });
  try {
    return new URL(url).hostname;
  } catch (err) {
    console.warn(`rss: extractFeedTitle could not parse url "${url}": ${errorMessage(err)}`);
    return url;
  }
}

function parseItem(raw: RssFeedItem, source: string): ContentItem {
  const title = decodeHtmlEntities(extractFeedEntryTitle(raw.title), {
    numeric: true,
  });

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
    parsed = parser.parse(xml) as RssFeedParsed;
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
    const urls = (config.params?.urls as string[]) ?? [];
    if (urls.length === 0) return [];

    const results = await Promise.all(urls.map(fetchFeed));
    return dedupeByKey(results.flat(), (item) => item.url || item.id);
  },
};

export default adapter;
