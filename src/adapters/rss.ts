import {
  extractAtomLink,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { warnEmptyConfig } from "./empty-config";
import {
  buildFeedContentItem,
  extractFeedEntryStrippedBody,
  projectFeedEntryToContentItem,
  resolveDecodedFeedRootTitle,
} from "./feed-entry";
import { fetchRssAtomFeed } from "./fetch";
import { compareItemTimestampDesc, fetchAllParallel, finalizeFetchedItems } from "./merge";
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
  return projectFeedEntryToContentItem("rss", raw, ({ title }) => {
    const link = extractAtomLink(raw.link);
    const body = extractFeedEntryStrippedBody(raw);
    return {
      idSuffix: link || `${title}:${simpleHash(body ?? "")}`,
      url: link || "",
      source,
      body,
    };
  });
}

async function fetchFeed(url: string): Promise<ContentItem[]> {
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
  return items.map((item) => parseItem(item, source));
}

const adapter: Adapter = {
  name: "rss",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const urls = normalizeParamStringList(config.params, "urls");
    if (urls.length === 0) {
      return warnEmptyConfig("rss", "no urls configured");
    }

    const allItems = await fetchAllParallel(urls, fetchFeed);
    return finalizeFetchedItems(allItems, {
      limit: Number.MAX_SAFE_INTEGER,
      dedupeKey: (item) => item.url || item.id,
      sort: compareItemTimestampDesc,
    });
  },
};

export default adapter;
