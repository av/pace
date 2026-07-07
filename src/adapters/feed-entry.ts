import {
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  extractXmlText,
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

/**
 * Date fields may carry XML attributes (e.g. `<updated type="...">`), in which
 * case the parser yields `{ "#text": ..., "@_type": ... }` instead of a string.
 */
export type FeedEntryDateFields = Partial<
  Record<FeedEntryDateField, XmlTextField | undefined>
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
    // Route through extractXmlText: a date element with attributes parses to
    // an object, and String() on it yields "[object Object]" -> now() fallback.
    const value = extractXmlText(item[key]);
    if (value) return value;
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

/** Decode feed entry title after stripping HTML (arxiv and similar Atom summaries). */
export function decodeFeedEntryStrippedTitle(
  title: XmlTextField | undefined,
  fallback = "(untitled)",
): string {
  return decodeNumericFeedTitle(
    stripHtml(extractFeedEntryTitle(title, fallback), FEED_BODY_STRIP_OPTIONS),
  );
}

export function resolveDecodedFeedRootTitle(
  rssTitle: XmlTextField | undefined,
  atomTitle: XmlTextField | undefined,
  fallback?: string,
): string | undefined {
  const raw = extractFeedRootTitle(rssTitle, atomTitle) ?? fallback;
  if (!raw) return undefined;
  return decodeNumericFeedTitle(raw).trim() || undefined;
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
  /** Override decoded entry title (e.g. github release display titles). */
  title?: string;
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

export type FeedEntryTitleDecoder = (
  title: XmlTextField | undefined,
) => string;

/** Project a feed XML entry to ContentItem via shared title/timestamp extraction. */
export function projectFeedEntryToContentItem(
  idPrefix: string,
  entry: FeedEntryProjectionInput,
  project: (ctx: { title: string; timestamp: Date }) => FeedEntryProjectedFields,
  dateOrder?: FeedEntryDateField[],
  decodeTitle: FeedEntryTitleDecoder = decodeFeedEntryTitle,
): ContentItem {
  const title = decodeTitle(entry.title);
  const timestamp = parseFeedEntryTimestamp(entry, dateOrder);
  const { idSuffix, url, source, body, title: titleOverride } = project({ title, timestamp });
  return buildFeedContentItem(`${idPrefix}:${idSuffix}`, {
    title: titleOverride ?? title,
    url,
    source,
    timestamp,
    body,
  });
}