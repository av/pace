import type { NotifyPayload, NotifyPayloadItem } from "./notify";

/**
 * Delivery format presets for notify rules. `json` is the raw
 * {@link NotifyPayload} (the default, for custom receivers); the others render
 * the same payload the way a popular service expects it, so a rule can point
 * straight at ntfy, a Discord webhook, or a Slack incoming webhook without a
 * translation shim in between.
 */
export const NOTIFY_FORMATS = ["json", "ntfy", "discord", "slack", "template"] as const;
export type NotifyFormat = (typeof NOTIFY_FORMATS)[number];

/** Everything a delivery needs besides the URL: body plus exact headers. */
export interface NotifyDelivery {
  body: string;
  headers: Record<string, string>;
}

/**
 * Merge a rule's custom `headers` over a format preset's delivery headers.
 * Custom headers win case-insensitively (so `x-title` replaces the ntfy
 * preset's `X-Title`), except config validation guarantees `Content-Type`
 * never appears among them — the preset owns the body shape.
 */
export function mergeNotifyHeaders(
  preset: Record<string, string>,
  custom: Record<string, string> | undefined,
): Record<string, string> {
  if (custom === undefined) return preset;
  const merged: Record<string, string> = {};
  const customNames = new Set(Object.keys(custom).map((name) => name.toLowerCase()));
  for (const [name, value] of Object.entries(preset)) {
    if (!customNames.has(name.toLowerCase())) merged[name] = value;
  }
  return Object.assign(merged, custom);
}

/** Discord caps message `content` at 2000 characters; stay safely under it. */
const DISCORD_CONTENT_LIMIT = 2000;

function headline(payload: NotifyPayload): string {
  const noun = payload.matched === 1 ? "new item" : "new items";
  return `pace: ${payload.matched} ${noun} for "${payload.rule}"`;
}

/** `…and N more` suffix when the payload (or a length cap) elides items. */
function moreLine(payload: NotifyPayload, shown: number): string | null {
  const hidden = payload.matched - shown;
  return hidden > 0 ? `…and ${hidden} more` : null;
}

function itemMeta(item: NotifyPayloadItem): string {
  return item.score !== null ? `${item.source}, score ${item.score}` : item.source;
}

/** Plain-text bullet lines for the payload's items (shared by ntfy/template). */
function plainItemLines(payload: NotifyPayload): string[] {
  const lines = payload.items.map((item) => `• ${item.title} (${itemMeta(item)})\n  ${item.url}`);
  const more = moreLine(payload, payload.items.length);
  if (more !== null) lines.push(more);
  return lines;
}

/**
 * Placeholders a `format: template` body may use, `{{name}}` style:
 * the rule's label, the total match count, the standard one-line headline,
 * and the plain-text item list (one bullet per item plus the `…and N more`
 * overflow line — the same list the ntfy preset sends).
 *
 * Every placeholder also has a `{{name_json}}` twin that substitutes as a
 * JSON literal instead of raw text — strings escaped and quoted, `matched`
 * a bare number — so a template can be a JSON envelope (say
 * `{"text": {{headline_json}}}`) that stays valid no matter what quotes or
 * newlines a feed title carries.
 *
 * `{{items_json_array}}` is a structural extra beyond the twins: a real JSON
 * array of the payload's item objects — the same {@link NotifyPayloadItem}
 * shape the `json` format sends (`title`, `url`, `source`, `panel`,
 * `timestamp`, `score`, `summary`) — for receivers that want structured
 * items rather than one preformatted text blob.
 */
const NOTIFY_TEMPLATE_BASE = ["rule", "matched", "headline", "items"] as const;
export const NOTIFY_TEMPLATE_PLACEHOLDERS: readonly string[] = [
  ...NOTIFY_TEMPLATE_BASE,
  ...NOTIFY_TEMPLATE_BASE.map((name) => `${name}_json`),
  "items_json_array",
];

/**
 * Placeholders an `item_template` may use, `{{name}}` style — one substitution
 * per payload item: its title, link, source adapter label, numeric score
 * (empty string when the item is unscored), and the standard "source" /
 * "source, score N" meta text the built-in presets show. Each also has a
 * `{{name_json}}` JSON-literal twin; `{{score_json}}` is a bare number, or
 * `null` when the item is unscored.
 */
const NOTIFY_ITEM_TEMPLATE_BASE = ["title", "url", "source", "score", "meta"] as const;
export const NOTIFY_ITEM_TEMPLATE_PLACEHOLDERS: readonly string[] = [
  ...NOTIFY_ITEM_TEMPLATE_BASE,
  ...NOTIFY_ITEM_TEMPLATE_BASE.map((name) => `${name}_json`),
];

function unknownPlaceholders(template: string, names: readonly string[]): string[] {
  const known = new Set<string>(names);
  const unknown = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    if (!known.has(match[1]!)) unknown.add(match[1]!);
  }
  return [...unknown];
}

/**
 * Every `{{name}}` token in the template that is not a known placeholder.
 * Config validation rejects these up front, so a typo like `{{item}}` fails
 * `pace config check` instead of delivering itself literally forever.
 */
export function unknownTemplatePlaceholders(template: string): string[] {
  return unknownPlaceholders(template, NOTIFY_TEMPLATE_PLACEHOLDERS);
}

/** Same, for an `item_template` against the per-item placeholder set. */
export function unknownItemTemplatePlaceholders(template: string): string[] {
  return unknownPlaceholders(template, NOTIFY_ITEM_TEMPLATE_PLACEHOLDERS);
}

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? values[name]! : token,
  );
}

/**
 * Add a `name_json` JSON-literal twin for every substitution value. The twin
 * encodes the plain-text value by default; `raw` overrides the value a twin
 * encodes for names whose JSON shape differs from their display text
 * (`matched` as a number, `score` as a number or `null`).
 */
function withJsonTwins(values: Record<string, string>, raw: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (const [name, value] of Object.entries(values)) {
    out[`${name}_json`] = JSON.stringify(Object.hasOwn(raw, name) ? raw[name] : value);
  }
  return out;
}

/**
 * User-defined body: the template with `{{placeholder}}` tokens substituted
 * (whitespace inside braces tolerated: `{{ rule }}` works). When the rule also
 * sets `item_template`, `{{items}}` is one rendered line per payload item
 * (per-item placeholders substituted) instead of the default bullet list; the
 * `…and N more` overflow line stays in either rendering. `{{name_json}}`
 * twins substitute JSON literals in both templates. Delivered as
 * plain text; a rule whose receiver wants a different content type sets a
 * custom `Content-Type` header — allowed for this format only, because here
 * the user, not a preset, owns the body shape.
 */
function renderTemplate(template: string, payload: NotifyPayload, itemTemplate?: string): NotifyDelivery {
  let itemLines: string[];
  if (itemTemplate === undefined) {
    itemLines = plainItemLines(payload);
  } else {
    itemLines = payload.items.map((item) =>
      substitute(
        itemTemplate,
        withJsonTwins(
          {
            title: item.title,
            url: item.url,
            source: item.source,
            score: item.score !== null ? String(item.score) : "",
            meta: itemMeta(item),
          },
          { score: item.score },
        ),
      ),
    );
    const more = moreLine(payload, payload.items.length);
    if (more !== null) itemLines.push(more);
  }
  const body = substitute(template, {
    ...withJsonTwins(
      {
        rule: payload.rule,
        matched: String(payload.matched),
        headline: headline(payload),
        items: itemLines.join("\n"),
      },
      { matched: payload.matched },
    ),
    // Structural extra (not a twin): the item objects as a real JSON array.
    items_json_array: JSON.stringify(payload.items),
  });
  return { body, headers: { "Content-Type": "text/plain; charset=utf-8" } };
}

/**
 * ntfy wants plain text: message body plus title/click metadata in headers.
 * Header values must be ISO-8859-1-safe, so the title is also carried as the
 * body's first line for servers/apps that drop non-Latin-1 headers.
 */
function renderNtfy(payload: NotifyPayload): NotifyDelivery {
  const lines = plainItemLines(payload);
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Title": headline(payload).replace(/[^\x20-\x7e]/g, "?"),
  };
  const first = payload.items[0];
  if (first !== undefined && /^[\x20-\x7e]+$/.test(first.url)) headers["X-Click"] = first.url;
  return { body: lines.join("\n"), headers };
}

/** Escape the characters Discord markdown treats specially in link labels. */
function escapeDiscordText(text: string): string {
  return text.replace(/([\\*_~`[\]()])/g, "\\$1");
}

/**
 * Discord webhook message: markdown `content`, capped at 2000 chars by
 * dropping trailing items into the `…and N more` line rather than truncating
 * mid-link (a cut-off markdown link renders as garbage).
 */
function renderDiscord(payload: NotifyPayload): NotifyDelivery {
  const itemLines = payload.items.map(
    (item) => `- [${escapeDiscordText(item.title)}](${item.url}) — ${escapeDiscordText(itemMeta(item))}`,
  );
  let shown = itemLines.length;
  let content = "";
  while (shown >= 0) {
    const lines = [`**${headline(payload)}**`, ...itemLines.slice(0, shown)];
    const more = moreLine(payload, shown);
    if (more !== null) lines.push(more);
    content = lines.join("\n");
    if (content.length <= DISCORD_CONTENT_LIMIT) break;
    shown -= 1;
  }
  return {
    body: JSON.stringify({ content }),
    headers: { "Content-Type": "application/json" },
  };
}

/** Escape the characters Slack requires escaping in mrkdwn text. */
function escapeSlackText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Slack incoming-webhook message: mrkdwn `text` with `<url|title>` links. */
function renderSlack(payload: NotifyPayload): NotifyDelivery {
  const lines = [
    `*${escapeSlackText(headline(payload))}*`,
    ...payload.items.map(
      (item) => `• <${item.url}|${escapeSlackText(item.title)}> — ${escapeSlackText(itemMeta(item))}`,
    ),
  ];
  const more = moreLine(payload, payload.items.length);
  if (more !== null) lines.push(more);
  return {
    body: JSON.stringify({ text: lines.join("\n") }),
    headers: { "Content-Type": "application/json" },
  };
}

/**
 * Render one delivery for a payload in the rule's format. The payload itself
 * is format-independent, so switching a rule's `format` never changes what
 * matches or the at-most-once ledger — only how the POST body looks.
 * `template` is the rule's user-defined body (config validation guarantees it
 * exists exactly when the format is "template"); `itemTemplate` is its
 * optional per-item line for `{{items}}`.
 */
export function renderNotifyDelivery(
  format: NotifyFormat,
  payload: NotifyPayload,
  template?: string,
  itemTemplate?: string,
): NotifyDelivery {
  switch (format) {
    case "template":
      if (template === undefined) throw new Error("notify: format \"template\" requires a template");
      return renderTemplate(template, payload, itemTemplate);
    case "ntfy":
      return renderNtfy(payload);
    case "discord":
      return renderDiscord(payload);
    case "slack":
      return renderSlack(payload);
    case "json":
      return { body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } };
  }
}
