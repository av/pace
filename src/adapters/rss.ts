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
import { aggregateParallelFeeds, sliceAndMap } from "./merge";
import { extractHostname } from "../dedupe";
import { clampAdapterLimit, normalizeParamStringList, simpleHash } from "../utils";
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
  feedUrl: string;
  source: string;
  timestamp: Date;
}

/** Resolve feed-relative entry links without rewriting already-absolute links. */
function resolveRssLink(raw: RssFeedItem, feedUrl: string): string {
  const link = extractAtomLink(raw.link);
  if (!link) return "";

  try {
    // Preserve absolute links exactly as published. The second parse handles
    // root-relative, path-relative, protocol-relative, query, and hash links.
    new URL(link);
    return link;
  } catch {
    try {
      return new URL(link, feedUrl).href;
    } catch {
      return link;
    }
  }
}

/** Extract the display fields and canonical ID from a raw RSS entry. */
function extractRssFields(raw: RssFeedItem, feedUrl: string) {
  const link = resolveRssLink(raw, feedUrl);
  const title = decodeFeedEntryTitle(raw.title);
  const body = extractFeedEntryStrippedBody(raw);
  const id = `rss:${link || `${title}:${simpleHash(body ?? "")}`}`;
  return { link, title, body, id };
}

function rssDedupeKey(item: TaggedRssItem): string {
  const link = resolveRssLink(item.raw, item.feedUrl);
  if (link) return link;
  return extractRssFields(item.raw, item.feedUrl).id;
}

function projectRssItem(item: TaggedRssItem): ContentItemProjection {
  const { link, title, body, id } = extractRssFields(item.raw, item.feedUrl);
  return {
    id,
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
  return sliceAndMap(items, limit, (raw) => ({
    raw,
    feedUrl: url,
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
