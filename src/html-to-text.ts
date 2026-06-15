/** Strip HTML to readable plain text; no external dependencies. */

/** Tags whose contents are fully discarded (including nested children). */
const DISCARD_TAG_RE =
  /<(script|style|nav|header|footer|aside|noscript)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;

/** Any remaining HTML tags (opening, closing, self-closing). */
const TAG_RE = /<[^>]+>/g;

/** Collapse runs of whitespace (including newlines) to a single space. */
const WHITESPACE_RE = /\s+/g;

/** Decode a small set of common HTML entities.
 *  &amp; is decoded last — all other named entities start with '&', so early
 *  &amp; decoding would double-decode sequences like &amp;lt; into <. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Convert an HTML string to plain readable text.
 * Strips script/style/nav tags and their contents, then removes remaining tags,
 * decodes entities, and collapses whitespace.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(DISCARD_TAG_RE, " ")
      .replace(TAG_RE, " ")
      .replace(WHITESPACE_RE, " ")
      .trim(),
  );
}
