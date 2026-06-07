import {
  extractFeedEntryTitle,
  extractFeedItemBody,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import {
  decodeNumericFeedTitle,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";

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

export function extractFeedEntryStrippedBody(
  item: FeedItemBodyFields,
): string | undefined {
  const rawBody = extractFeedItemBody(item);
  return rawBody ? stripHtml(rawBody, FEED_BODY_STRIP_OPTIONS) : undefined;
}