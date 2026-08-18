import type { NotifyPayload, NotifyPayloadItem } from "./notify";

/**
 * Delivery format presets for notify rules. `json` is the raw
 * {@link NotifyPayload} (the default, for custom receivers); the others render
 * the same payload the way a popular service expects it, so a rule can point
 * straight at ntfy, a Discord webhook, or a Slack incoming webhook without a
 * translation shim in between.
 */
export const NOTIFY_FORMATS = ["json", "ntfy", "discord", "slack"] as const;
export type NotifyFormat = (typeof NOTIFY_FORMATS)[number];

/** Everything a delivery needs besides the URL: body plus exact headers. */
export interface NotifyDelivery {
  body: string;
  headers: Record<string, string>;
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

/**
 * ntfy wants plain text: message body plus title/click metadata in headers.
 * Header values must be ISO-8859-1-safe, so the title is also carried as the
 * body's first line for servers/apps that drop non-Latin-1 headers.
 */
function renderNtfy(payload: NotifyPayload): NotifyDelivery {
  const lines = payload.items.map((item) => `• ${item.title} (${itemMeta(item)})\n  ${item.url}`);
  const more = moreLine(payload, payload.items.length);
  if (more !== null) lines.push(more);
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
 */
export function renderNotifyDelivery(format: NotifyFormat, payload: NotifyPayload): NotifyDelivery {
  switch (format) {
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
