export type AtomLinkField =
  | string
  | { "@_href"?: string; "@_rel"?: string }
  | Array<{ "@_href"?: string; "@_rel"?: string }>
  | undefined;

/** Parsed text node from fast-xml-parser (attributeNamePrefix "@_"). */
export type XmlTextField = string | { "#text"?: string; __cdata?: string };

/** RSS 2.0 / Atom item fields commonly used for body text. */
export type FeedItemBodyFields = {
  description?: XmlTextField;
  summary?: XmlTextField;
  content?: XmlTextField;
  "content:encoded"?: XmlTextField;
};

/** fast-xml-parser options shared by RSS/Atom feed adapters. */
export const FEED_XML_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_" as const,
};

/** Normalize a single parsed node or list from fast-xml-parser. */
export function normalizeXmlList<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Extract string from an XML text field; undefined when absent or empty. */
export function extractXmlText(
  field: XmlTextField | undefined | null,
): string | undefined {
  if (field == null) return undefined;
  if (typeof field === "string") return field || undefined;
  const text = field["#text"] ?? field.__cdata;
  return typeof text === "string" && text ? text : undefined;
}

/** First non-empty body among RSS description/summary and Atom content fields. */
export function extractFeedItemBody(
  item: FeedItemBodyFields,
): string | undefined {
  return (
    extractXmlText(item.description) ??
    extractXmlText(item.summary) ??
    extractXmlText(item.content) ??
    extractXmlText(item["content:encoded"])
  );
}

/** Channel/feed title from RSS 2.0 or Atom root, whichever is present. */
export function extractFeedRootTitle(
  rssTitle: XmlTextField | undefined,
  atomTitle: XmlTextField | undefined,
): string | undefined {
  return extractXmlText(rssTitle) ?? extractXmlText(atomTitle);
}

/** Items from RSS channel.item or Atom feed.entry. */
export function extractRssAtomItems<T>(parsed: {
  rss?: { channel?: { item?: T | T[] } };
  feed?: { entry?: T | T[] };
}): T[] {
  const rssItems = parsed.rss?.channel?.item;
  if (rssItems != null) return normalizeXmlList(rssItems);
  const atomEntries = parsed.feed?.entry;
  if (atomEntries != null) return normalizeXmlList(atomEntries);
  return [];
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