import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "a", "em", "strong", "del", "s", "code", "ul", "ol", "li",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "pre", "blockquote", "details", "summary", "img",
    "br", "hr",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt"],
    code: ["class"],
  },
  allowedSchemes: ["https", "http"],
  disallowedTagsMode: "discard",
  transformTags: {
    // A link that opens a new browsing context must not hand the target page
    // a window.opener reference (reverse tabnabbing). Modern browsers imply
    // noopener for target="_blank", but feed content may use other targets
    // and older engines don't - force it whenever target is present.
    a: (tagName, attribs) => {
      if (attribs.target !== undefined) {
        const rel = new Set((attribs.rel ?? "").split(/\s+/).filter(Boolean));
        rel.add("noopener");
        attribs.rel = [...rel].join(" ");
      }
      return { tagName, attribs };
    },
  },
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

const STATIC_RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  ...SANITIZE_OPTIONS,
  allowedTags: [...(SANITIZE_OPTIONS.allowedTags as string[]), "span"],
  transformTags: {
    ...SANITIZE_OPTIONS.transformTags,
    img: (_tagName, attribs) => {
      const alt = (attribs.alt ?? "").trim();
      return {
        tagName: "span",
        attribs: {},
        text: alt
          ? `[Image: ${alt} — not included in static snapshots]`
          : "[Image not included in static snapshots]",
      };
    },
  },
};

/** Replace rich-text images with visible context for non-fetching static snapshots. */
export function renderStaticRichText(sanitizedHtml: string): string {
  return sanitizeHtml(sanitizedHtml, STATIC_RICH_TEXT_OPTIONS);
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
