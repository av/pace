/** Strip HTML to readable plain text. */

import { decodeHtmlEntities } from "./adapters/html";

/** Tags whose contents are fully discarded (including nested children). */
const DISCARD_TAG_RE =
  /<(script|style|nav|header|footer|aside|noscript)(\s[^>]*)?>[\s\S]*?<\/\1>/gi;

/** Any remaining HTML tags (opening, closing, self-closing). */
const TAG_RE = /<[^>]+>/g;

/** Collapse runs of whitespace (including newlines) to a single space. */
const WHITESPACE_RE = /\s+/g;

/**
 * Convert an HTML string to plain readable text.
 * Strips script/style/nav tags and their contents, then removes remaining tags,
 * decodes entities (including numeric), and collapses whitespace.
 */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(DISCARD_TAG_RE, " ")
      .replace(TAG_RE, " ")
      .replace(WHITESPACE_RE, " ")
      .trim(),
    { numeric: true },
  );
}
