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

export function decodeHtmlEntities(
  str: string,
  options?: { numeric?: boolean },
): string {
  let s = str;
  if (options?.numeric) {
    s = s
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
        String.fromCharCode(parseInt(code, 16)),
      );
  }
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
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