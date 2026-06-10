import {
  extractAtomLink,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { mapToContentItemsPerSource, type ContentItemProjection } from "./content-item";
import { warnEmptyConfig } from "./empty-config";
import {
  decodeFeedEntryTitle,
  extractFeedEntryStrippedBody,
  FEED_ENTRY_DATE_RSS_ORDER,
  parseFeedEntryTimestamp,
  resolveDecodedFeedRootTitle,
} from "./feed-entry";
import { fetchRssAtomFeed } from "./fetch";
import { aggregateParallelFeeds } from "./merge";
import { extractHostname } from "../dedupe";
import { clampAdapterLimit, normalizeParamStringList, simpleHash, sliceToLimit } from "../utils";
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

interface TaggedRssItem {
  raw: RssFeedItem;
  source: string;
  timestamp: Date;
}

function rssDedupeKey(item: TaggedRssItem): string {
  const link = extractAtomLink(item.raw.link);
  if (link) return link;
  const title = decodeFeedEntryTitle(item.raw.title);
  const body = extractFeedEntryStrippedBody(item.raw);
  return `rss:${link || `${title}:${simpleHash(body ?? "")}`}`;
}

function projectRssItem(item: TaggedRssItem): ContentItemProjection {
  const link = extractAtomLink(item.raw.link);
  const title = decodeFeedEntryTitle(item.raw.title);
  const body = extractFeedEntryStrippedBody(item.raw);
  return {
    id: `rss:${link || `${title}:${simpleHash(body ?? "")}`}`,
    title,
    url: link || "",
    timestamp: item.timestamp,
    body,
  };
}

async function fetchFeed(url: string, limit: number): Promise<TaggedRssItem[]> {
  const { parsed, items } = await fetchRssAtomFeed<RssFeedItem, RssFeedParsed>(
    "rss",
    url,
    url,
  );
  const feedTitle = resolveDecodedFeedRootTitle(
    parsed?.rss?.channel?.title,
    parsed?.feed?.title,
  );
  const source = feedTitle ?? (extractHostname(url, "rss") || url);
  return sliceToLimit(items, limit).map((raw) => ({
    raw,
    source,
    timestamp: parseFeedEntryTimestamp(raw, FEED_ENTRY_DATE_RSS_ORDER),
  }));
}

const adapter: Adapter = {
  name: "rss",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const urls = normalizeParamStringList(config.params, "urls");
    if (urls.length === 0) {
      return warnEmptyConfig("rss", "no urls configured");
    }

    const limitRaw = config.params?.limit;
    const perFeedLimit =
      limitRaw !== undefined
        ? clampAdapterLimit(limitRaw, 50, 200)
        : Number.MAX_SAFE_INTEGER;

    const tagged = await aggregateParallelFeeds(urls, (url) => fetchFeed(url, perFeedLimit), {
      perSourceLimit: perFeedLimit,
      dedupeKey: rssDedupeKey,
    });

    return mapToContentItemsPerSource(tagged, (item) => item.source, projectRssItem);
  },
};

export default adapter;