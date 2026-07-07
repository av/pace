type StripHtmlWhitespace = "preserve" | "collapse-newlines" | "collapse-all";

interface StripHtmlOptions {
  blockBreaks?: boolean;
  whitespace?: StripHtmlWhitespace;
  tagSeparator?: string;
  numericEntities?: boolean;
}

/** Shared strip options for feed bodies and inline HTML snippets (e.g. GitHub trending descriptions). */
export const FEED_BODY_STRIP_OPTIONS = {
  tagSeparator: " ",
  whitespace: "collapse-all" as const,
  numericEntities: true,
} satisfies StripHtmlOptions;

/** Decode named and numeric HTML entities for feed/API titles (adapter convention). */
export function decodeNumericFeedTitle(text: string): string {
  return decodeHtmlEntities(text, { numeric: true });
}

export function decodeNumericFeedTitleOptional(
  text?: string | undefined,
  fallback = "(untitled)",
): string {
  if (!text) return fallback;
  return decodeNumericFeedTitle(text);
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  amp: "&",
};

/** Decode a numeric character reference safely: astral-plane aware, and
 *  out-of-range/surrogate/NUL references pass through as literal text. */
function decodeNumericEntity(match: string, dec?: string, hex?: string): string {
  const codePoint =
    dec !== undefined ? parseInt(dec, 10) : parseInt(hex ?? "", 16);
  if (
    !Number.isFinite(codePoint) ||
    codePoint <= 0 ||
    codePoint > 0x10ffff ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  ) {
    return match;
  }
  return String.fromCodePoint(codePoint);
}

const ENTITY_PATTERN = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g;

/** Single-pass entity decoder: each source entity decodes at most once, so
 *  double-escaped input like `&#38;lt;` yields the literal `&lt;` (not `<`). */
export function decodeHtmlEntities(
  str: string,
  options?: { numeric?: boolean },
): string {
  const numeric = options?.numeric ?? false;
  return str.replace(ENTITY_PATTERN, (match, dec, hex, name) => {
    if (name !== undefined) {
      if (name.toLowerCase() === "nbsp") return " ";
      return NAMED_ENTITIES[name] ?? match;
    }
    // `&#39;` decodes even in non-numeric mode (legacy adapter convention).
    if (!numeric && !(dec === "39" && match === "&#39;")) return match;
    return decodeNumericEntity(match, dec, hex);
  });
}

export function stripHtml(html: string, options?: StripHtmlOptions): string {
  const {
    blockBreaks = false,
    whitespace = "collapse-newlines",
    tagSeparator = "",
    numericEntities = false,
  } = options ?? {};

  let text = html;
  if (blockBreaks) {
    text = text
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n");
  }

  text = text.replace(/<[^>]*>/g, tagSeparator);
  text = decodeHtmlEntities(text, { numeric: numericEntities });

  if (whitespace === "collapse-all") {
    text = text.replace(/\s+/g, " ");
  } else if (whitespace === "collapse-newlines") {
    text = text.replace(/\n{3,}/g, "\n\n");
  }

  return text.trim();
}