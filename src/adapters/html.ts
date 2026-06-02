type StripHtmlWhitespace = "preserve" | "collapse-newlines" | "collapse-all";

interface StripHtmlOptions {
  /** Convert &lt;br&gt; and &lt;/p&gt; to newlines before stripping tags (Mastodon). */
  blockBreaks?: boolean;
  /** Whitespace normalization after entity decode. Default: collapse-newlines. */
  whitespace?: StripHtmlWhitespace;
  /** String inserted where tags were removed. Default: "". */
  tagSeparator?: string;
  /** Decode &#123; and &#xAB; numeric entities (podcast RSS). */
  numericEntities?: boolean;
}

/** Decode common HTML/XML named entities; optionally numeric &#…; / &#x…. */
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

/** Strip HTML tags and decode entities; behavior tuned per adapter via options. */
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

  const tagPattern = tagSeparator === " " ? /<[^>]*>/g : /<[^>]+>/g;
  text = text.replace(tagPattern, tagSeparator);
  text = decodeHtmlEntities(text, { numeric: numericEntities });

  if (whitespace === "collapse-all") {
    text = text.replace(/\s+/g, " ");
  } else if (whitespace === "collapse-newlines") {
    text = text.replace(/\n{3,}/g, "\n\n");
  }

  return text.trim();
}