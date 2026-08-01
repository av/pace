import { XMLParser } from "fast-xml-parser";
import { errorMessage } from "../utils";
import { warnMalformedFeedField } from "./empty-config";
import { decodeHtmlEntities } from "./html";

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
  // Keep text nodes as strings: the default (true) turns numeric-looking
  // values into numbers, so a feed item titled "1984" became `(untitled)`,
  // numeric guids/descriptions were dropped, and numeric channel titles
  // lost the feed's source label.
  parseTagValue: false,
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
  // Defense against parsers configured with numeric tag-value coercion.
  if (typeof field === "number") return String(field);
  const text = field["#text"] ?? field.__cdata;
  if (typeof text === "number") return String(text);
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
 * True when parsed XML has an RSS (`<rss>`) or Atom (`<feed>`) root element.
 * Garbage/non-feed responses (HTML error pages, JSON, plain text) parse without
 * throwing but lack both roots - callers should surface that as a fetch failure
 * instead of treating it as a healthy empty feed.
 */
export function hasRssAtomFeedRoot(parsed: unknown): boolean {
  if (parsed == null || typeof parsed !== "object") return false;
  const record = parsed as { rss?: unknown; feed?: unknown };
  return record.rss != null || record.feed != null;
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

/**
 * Link rels that never point at the entry's web page. A lone
 * `rel="enclosure"`/`rel="self"` link must not become the item URL.
 */
const NON_PAGE_LINK_RELS = new Set([
  "enclosure",
  "self",
  "hub",
  "edit",
  "edit-media",
  "replies",
  "icon",
  "license",
  "via",
  "first",
  "last",
  "next",
  "previous",
  "prev",
]);

function decodeFeedLink(link: string | undefined): string {
  return decodeHtmlEntities(link ?? "", { numeric: true });
}

export function extractAtomLink(link: AtomLinkField): string {
  if (!link) return "";
  if (typeof link === "string") return decodeFeedLink(link);
  const links = Array.isArray(link) ? link : [link];
  // Atom spec: absent rel is equivalent to rel="alternate".
  const alt = links.find(
    (l) => l["@_rel"] === "alternate" && l["@_href"],
  );
  if (alt) return decodeFeedLink(alt["@_href"]);
  const noRel = links.find((l) => !l["@_rel"] && l["@_href"]);
  if (noRel) return decodeFeedLink(noRel["@_href"]);
  const fallback = links.find(
    (l) => l["@_href"] && !NON_PAGE_LINK_RELS.has(l["@_rel"] ?? ""),
  );
  return decodeFeedLink(fallback?.["@_href"]);
}
