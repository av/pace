import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "a", "em", "strong", "code", "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "pre", "blockquote", "details", "summary", "img",
    "br", "hr",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt"],
  },
  allowedSchemes: ["https", "http"],
  disallowedTagsMode: "discard",
};

/** Sanitize HTML string using the project allowlist. */
export function sanitize(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** Render Markdown to sanitized HTML. Uses marked with GFM enabled. */
export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { gfm: true, async: false }) as string;
  return sanitize(raw);
}

/** Escape HTML special characters. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render plain text as HTML: escape special chars and convert newlines to <br>. */
export function renderPlain(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}
