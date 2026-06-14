import { XMLParser } from "fast-xml-parser";
import { errorMessage } from "../utils";
import { warnMalformedFeedField } from "./empty-config";

export type AtomLinkField =
  | string
  | { "@_href"?: string; "@_rel"?: string }
  | Array<{ "@_href"?: string; "@_rel"?: string }>
  | undefined;

export type XmlTextField = string | { "#text"?: string; __cdata?: string };

export type FeedItemBodyFields = {
  description?: XmlTextField;
  "itunes:summary"?: XmlTextField;
  "itunes:subtitle"?: XmlTextField;
  summary?: XmlTextField;
  content?: XmlTextField;
  "content:encoded"?: XmlTextField;
};

export const FEED_XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_" as const,
};

export const feedXmlParser = new XMLParser(FEED_XML_PARSER_OPTIONS);

/** Podcast feeds need CDATA + trimmed values; default feed parser leaves these unparsed. */
export const podcastFeedXmlParser = new XMLParser({
  ...FEED_XML_PARSER_OPTIONS,
  cdataPropName: "__cdata",
  trimValues: true,
});

/** Parse XML with `${prefix}: error parsing xml from ${context}` on failure. */
export function parseXml<T>(
  xml: string,
  parser: XMLParser,
  prefix: string,
  context: string,
): T {
  try {
    return parser.parse(xml) as T;
  } catch (err) {
    throw new Error(
      `${prefix}: error parsing xml from ${context}: ${errorMessage(err)}`,
    );
  }
}

/** Parse feed XML with the shared feed parser. */
export function parseFeedXml<T>(
  xml: string,
  prefix: string,
  context: string,
): T {
  return parseXml(xml, feedXmlParser, prefix, context);
}

export function normalizeXmlList<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function extractXmlText(
  field: XmlTextField | undefined | null,
): string | undefined {
  if (field == null) return undefined;
  if (typeof field === "string") return field || undefined;
  const text = field["#text"] ?? field.__cdata;
  return typeof text === "string" && text ? text : undefined;
}

export function extractFeedItemBody(
  item: FeedItemBodyFields,
): string | undefined {
  return (
    extractXmlText(item.description) ??
    extractXmlText(item["itunes:summary"]) ??
    extractXmlText(item["itunes:subtitle"]) ??
    extractXmlText(item.summary) ??
    extractXmlText(item.content) ??
    extractXmlText(item["content:encoded"])
  );
}

export function extractFeedEntryTitle(
  title: XmlTextField | undefined,
  fallback = "(untitled)",
): string {
  return extractXmlText(title) ?? fallback;
}

export function extractFeedRootTitle(
  rssTitle: XmlTextField | undefined,
  atomTitle: XmlTextField | undefined,
): string | undefined {
  return extractXmlText(rssTitle) ?? extractXmlText(atomTitle);
}

export type FeedItemWarnContext = {
  prefix: string;
  context: string;
};



/**
 * Normalize RSS `channel.item` / Atom `feed.entry` lists.
 * Absent fields return [] silently. Malformed primitives or non-object array
 * entries return []; warn when `warn` context is provided (fetch layer).
 */
export function normalizeFeedItemList<T>(
  value: T | T[] | undefined | null,
  field: string,
  warn?: FeedItemWarnContext,
): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const malformed = value.some(
      (entry) => entry == null || typeof entry !== "object",
    );
    if (malformed) {
      if (warn) {
        warnMalformedFeedField(
          warn.prefix,
          field,
          warn.context,
          "array contains non-object entry",
        );
      }
      return [];
    }
    return value;
  }
  if (typeof value === "object") return [value];
  if (warn) {
    warnMalformedFeedField(warn.prefix, field, warn.context, `got ${typeof value}`);
  }
  return [];
}

export function extractRssAtomItems<T>(
  parsed: {
    rss?: { channel?: { item?: T | T[] } };
    feed?: { entry?: T | T[] };
  },
  warn?: FeedItemWarnContext,
): T[] {
  const rssItems = parsed.rss?.channel?.item;
  if (rssItems != null) return normalizeFeedItemList(rssItems, "item", warn);
  const atomEntries = parsed.feed?.entry;
  if (atomEntries != null) return normalizeFeedItemList(atomEntries, "entry", warn);
  return [];
}

/**
 * True when a feed parsed successfully with a feed root but zero extractable items,
 * and the item/entry field is absent or an empty array (not malformed - shape warn covers that).
 */
export function shouldWarnLegitimatelyEmptyFeed<T>(
  parsed: {
    rss?: { channel?: { item?: T | T[] } };
    feed?: { entry?: T | T[] };
  },
  items: T[],
): boolean {
  if (items.length > 0) return false;

  const hasFeedRoot = parsed.rss?.channel != null || parsed.feed != null;
  if (!hasFeedRoot) return false;

  const rssItems = parsed.rss?.channel?.item;
  if (rssItems != null) {
    if (Array.isArray(rssItems)) return rssItems.length === 0;
    return typeof rssItems === "object";
  }

  const atomEntries = parsed.feed?.entry;
  if (atomEntries != null) {
    if (Array.isArray(atomEntries)) return atomEntries.length === 0;
    return typeof atomEntries === "object";
  }

  return true;
}

export function extractAtomLink(link: AtomLinkField): string {
  if (!link) return "";
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alt = link.find((l) => l["@_rel"] === "alternate");
    return alt?.["@_href"] ?? link[0]?.["@_href"] ?? "";
  }
  return link["@_href"] ?? "";
}