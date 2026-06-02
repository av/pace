/** Parsed Atom/RSS link field from fast-xml-parser (attributeNamePrefix "@_"). */
export type AtomLinkField =
  | string
  | { "@_href"?: string; "@_rel"?: string }
  | Array<{ "@_href"?: string; "@_rel"?: string }>
  | undefined;

/**
 * Resolves a feed item link from RSS string links or Atom link elements
 * (single object or array; prefers rel="alternate").
 */
export function extractAtomLink(link: AtomLinkField): string {
  if (!link) return "";
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alt = link.find((l) => l["@_rel"] === "alternate");
    return alt?.["@_href"] ?? link[0]?.["@_href"] ?? "";
  }
  return link["@_href"] ?? "";
}