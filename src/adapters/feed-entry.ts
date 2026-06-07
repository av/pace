import {
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import {
  decodeNumericFeedTitle,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";
import type { ContentItem } from "./types";

export type FeedEntryDateField =
  | "pubDate"
  | "published"
  | "updated"
  | "dc:date";

export type FeedEntryDateFields = Partial<
  Record<FeedEntryDateField, string | undefined>
>;

/** RSS 2.0 / hybrid feeds: pubDate, then Atom-style updated/published. */
export const FEED_ENTRY_DATE_RSS_ORDER: FeedEntryDateField[] = [
  "pubDate",
  "updated",
  "published",
];

/** Atom entries: published before updated. */
export const FEED_ENTRY_DATE_ATOM_ORDER: FeedEntryDateField[] = [
  "published",
  "updated",
];

/** Podcast RSS: pubDate plus Dublin Core and Atom fallbacks. */
export const FEED_ENTRY_DATE_PODCAST_ORDER: FeedEntryDateField[] = [
  "pubDate",
  "published",
  "updated",
  "dc:date",
];

export function coalesceFeedEntryDateStr(
  item: FeedEntryDateFields,
  order: FeedEntryDateField[] = FEED_ENTRY_DATE_RSS_ORDER,
): string {
  for (const key of order) {
    const value = item[key];
    if (value) return String(value);
  }
  return "";
}

export function parseFeedEntryTimestamp(
  item: FeedEntryDateFields,
  order?: FeedEntryDateField[],
): Date {
  return parseFeedDate(coalesceFeedEntryDateStr(item, order));
}

export function decodeFeedEntryTitle(
  title: XmlTextField | undefined,
  fallback = "(untitled)",
): string {
  return decodeNumericFeedTitle(extractFeedEntryTitle(title, fallback));
}

export function resolveDecodedFeedRootTitle(
  rssTitle: XmlTextField | undefined,
  atomTitle: XmlTextField | undefined,
  fallback?: string,
): string | undefined {
  const raw = extractFeedRootTitle(rssTitle, atomTitle) ?? fallback;
  if (!raw) return undefined;
  return decodeNumericFeedTitle(raw);
}

export function extractFeedEntryStrippedBody(
  item: FeedItemBodyFields,
): string | undefined {
  const rawBody = extractFeedItemBody(item);
  return rawBody ? stripHtml(rawBody, FEED_BODY_STRIP_OPTIONS) : undefined;
}

export type FeedEntryProjectionInput = FeedEntryDateFields & {
  title?: XmlTextField;
};

export type FeedEntryProjectedFields = Pick<
  ContentItem,
  "url" | "source"
> & {
  idSuffix: string;
  body?: string;
};

/** Assemble a feed-sourced ContentItem from resolved id/url/source/timestamp/body fields. */
export function buildFeedContentItem(
  id: string,
  fields: Pick<ContentItem, "title" | "url" | "source" | "timestamp"> & {
    body?: string;
  },
): ContentItem {
  return { id, ...fields };
}

/** Project a feed XML entry to ContentItem via shared title/timestamp extraction. */
export function projectFeedEntryToContentItem(
  idPrefix: string,
  entry: FeedEntryProjectionInput,
  project: (ctx: { title: string; timestamp: Date }) => FeedEntryProjectedFields,
  dateOrder?: FeedEntryDateField[],
): ContentItem {
  const title = decodeFeedEntryTitle(entry.title);
  const timestamp = parseFeedEntryTimestamp(entry, dateOrder);
  const { idSuffix, url, source, body } = project({ title, timestamp });
  return buildFeedContentItem(`${idPrefix}:${idSuffix}`, {
    title,
    url,
    source,
    timestamp,
    body,
  });
}