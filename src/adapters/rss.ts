import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { fetchRssAtomFeed } from "./fetch";
import { decodeNumericFeedTitle, FEED_BODY_STRIP_OPTIONS, stripHtml } from "./html";
import { fetchAllParallelDedupe } from "./merge";
import { extractHostname } from "../dedupe";
import { normalizeParamStringList, simpleHash } from "../utils";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

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
  const { parsed, items } = await fetchRssAtomFeed<RssFeedItem, RssFeedParsed>(
    "rss",
    url,
    url,
  );
  const feedTitle = extractFeedRootTitle(
    parsed?.rss?.channel?.title,
    parsed?.feed?.title,
  );
  const source = feedTitle
    ? decodeNumericFeedTitle(feedTitle)
    : extractHostname(url, "rss") || url;
  return items.map((item) => parseItem(item, source));
}

const adapter: Adapter = {
  name: "rss",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const urls = normalizeParamStringList(config.params, "urls");
    if (urls.length === 0) {
      console.warn("rss: no urls configured");
      return [];
    }

    return fetchAllParallelDedupe(urls, fetchFeed, (item) => item.url || item.id);
  },
};

export default adapter;
