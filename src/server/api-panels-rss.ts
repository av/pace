import type { Context } from "hono";
import type { DashboardPanel } from "../layout/types";
import type { ContentItemRow, DashboardPanelSnapshot } from "../db";
import {
  loadApiPanelSnapshot,
  parseApiPanelItemsLimit,
  resolveApiPanel,
} from "./api-panels";
import type { ServerRouteDeps } from "./routes";

/** Path suffix that switches /api/panels/:panel from JSON to RSS output. */
export const RSS_PANEL_SUFFIX = ".rss";

/** Content type served for panel RSS feeds. */
export const RSS_CONTENT_TYPE = "application/rss+xml; charset=utf-8";

/**
 * Characters that are illegal in an XML 1.0 document even when escaped: the C0
 * control range minus tab (#x9), LF (#xA), CR (#xD), plus the two non-characters
 * #xFFFE/#xFFFF. Aggregated feed content routinely carries stray control bytes
 * (form feeds, ANSI escapes, NULs from bad scrapes); left in, a single one makes
 * the whole feed unparseable to strict readers, so they are dropped before
 * escaping rather than emitted as-is.
 */
const XML_ILLEGAL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

/** Escape a string for use in XML text content or attribute values. */
export function escapeXml(value: string): string {
  return value
    .replace(XML_ILLEGAL_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Format an ISO timestamp as the RFC 822 date RSS requires
 * ("Sat, 01 Aug 2026 10:00:00 GMT"). Unparseable input yields null so the
 * date element is omitted rather than emitting "Invalid Date".
 */
export function formatRssDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toUTCString();
}

/** Render one stored row as an RSS <item>. */
export function renderRssItem(row: ContentItemRow): string {
  const lines = [
    `<title>${escapeXml(row.title)}</title>`,
    `<link>${escapeXml(row.url)}</link>`,
    `<guid isPermaLink="false">${escapeXml(row.id)}</guid>`,
    `<category>${escapeXml(row.source)}</category>`,
  ];
  const pubDate = formatRssDate(row.timestamp);
  if (pubDate) lines.push(`<pubDate>${pubDate}</pubDate>`);
  const description = row.summary ?? row.body;
  if (description) lines.push(`<description>${escapeXml(description)}</description>`);
  return `    <item>\n      ${lines.join("\n      ")}\n    </item>`;
}

export type RssFeedLinks = {
  /** Human-facing dashboard URL for the channel <link>. */
  siteUrl: string;
  /** Canonical URL of this feed for the atom:link rel="self". */
  feedUrl: string;
};

/** Render a panel snapshot as a complete RSS 2.0 document. */
export function renderPanelRss(
  panel: DashboardPanel,
  snapshot: DashboardPanelSnapshot,
  links: RssFeedLinks,
): string {
  const name = panel.panel.panel;
  const channelLines = [
    `<title>${escapeXml(name)}</title>`,
    `<link>${escapeXml(links.siteUrl)}</link>`,
    `<atom:link href="${escapeXml(links.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `<description>${escapeXml(`Items from the ${name} panel on pace`)}</description>`,
    `<generator>pace</generator>`,
  ];
  const lastBuildDate = formatRssDate(snapshot.lastRefreshedAt);
  if (lastBuildDate) channelLines.push(`<lastBuildDate>${lastBuildDate}</lastBuildDate>`);

  const items = snapshot.items.map(renderRssItem);
  const channelBody = ["    " + channelLines.join("\n    "), ...items].join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `  <channel>`,
    channelBody,
    `  </channel>`,
    `</rss>`,
    ``,
  ].join("\n");
}

/**
 * Derive the channel/self links from the incoming request URL, so the feed
 * advertises whatever host and base path the client actually reached (query
 * string dropped from the self link — the canonical feed has no params).
 */
export function resolveRssFeedLinks(requestUrl: string, basePath: string): RssFeedLinks {
  const url = new URL(requestUrl);
  return {
    siteUrl: `${url.origin}${basePath === "" ? "/" : basePath}`,
    feedUrl: `${url.origin}${url.pathname}`,
  };
}

/**
 * GET /api/panels/:panel.rss — one panel's deduped items as an RSS 2.0 feed,
 * so pace panels (including transform pipelines) can feed regular feed
 * readers. Same panel lookup, `?limit=` override, and cached snapshots as the
 * JSON endpoint.
 */
export function handleApiPanelRss(c: Context, deps: ServerRouteDeps): Response {
  const param = c.req.param("panel")!; // route pattern /api/panels/:panel guarantees presence
  const panelParam = param.slice(0, -RSS_PANEL_SUFFIX.length);
  const panel: DashboardPanel | undefined = panelParam
    ? resolveApiPanel(panelParam, deps)
    : undefined;
  if (!panel) return c.json({ error: `Unknown panel: ${panelParam}` }, 404);

  const limitResult = parseApiPanelItemsLimit(c.req.query("limit"));
  if (!limitResult.ok) return c.json({ error: limitResult.error }, 400);

  const snapshot = loadApiPanelSnapshot(panel, limitResult.limit);
  const xml = renderPanelRss(panel, snapshot, resolveRssFeedLinks(c.req.url, deps.basePath));
  return c.body(xml, 200, { "content-type": RSS_CONTENT_TYPE });
}
