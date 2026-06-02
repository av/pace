export type AtomLinkField =
  | string
  | { "@_href"?: string; "@_rel"?: string }
  | Array<{ "@_href"?: string; "@_rel"?: string }>
  | undefined;

/** Parsed text node from fast-xml-parser (attributeNamePrefix "@_"). */
export type XmlTextField = string | { "#text"?: string; __cdata?: string };

/** Extract string from an XML text field; undefined when absent or empty. */
export function extractXmlText(
  field: XmlTextField | undefined | null,
): string | undefined {
  if (field == null) return undefined;
  if (typeof field === "string") return field || undefined;
  const text = field["#text"] ?? field.__cdata;
  return typeof text === "string" && text ? text : undefined;
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