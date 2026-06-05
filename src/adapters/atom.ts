import { XMLParser } from "fast-xml-parser";
import { errorMessage } from "../utils";

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

/** Parse feed XML with `${prefix}: error parsing xml from ${context}` on failure. */
export function parseFeedXml<T>(
  xml: string,
  prefix: string,
  context: string,
): T {
  try {
    return feedXmlParser.parse(xml) as T;
  } catch (err) {
    throw new Error(
      `${prefix}: error parsing xml from ${context}: ${errorMessage(err)}`,
    );
  }
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