import type { Context } from "hono";
import type { StarredContentItemRow } from "../db";
import { getStarredItems } from "../db";
import { parseApiPanelItemsLimit } from "./api-panels";
import {
  escapeXml,
  formatRssDate,
  renderRssItem,
  resolveRssFeedLinks,
  RSS_CONTENT_TYPE,
  type RssFeedLinks,
} from "./api-panels-rss";
import type { ServerRouteDeps } from "./routes";

/**
 * Render the starred items as a complete RSS 2.0 document — the reading list
 * as a subscribable feed. The most recent star mark doubles as the channel's
 * build date (that is when the list last grew), while each item keeps its own
 * story timestamp as pubDate; an empty list omits the build date rather than
 * inventing a timestamp.
 */
export function renderStarredRss(rows: StarredContentItemRow[], links: RssFeedLinks): string {
  const channelLines = [
    `<title>pace: starred items</title>`,
    `<link>${escapeXml(links.siteUrl)}</link>`,
    `<atom:link href="${escapeXml(links.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `<description>Items starred on pace</description>`,
    `<generator>pace</generator>`,
  ];
  const lastBuildDate = formatRssDate(rows[0]?.starred_at ?? null);
  if (lastBuildDate) channelLines.push(`<lastBuildDate>${lastBuildDate}</lastBuildDate>`);

  const items = rows.map(renderRssItem);
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
 * GET /api/star.rss[?limit=N] — the starred items as an RSS 2.0 feed, newest
 * star first, so the reading list built with the `s` key is subscribable from
 * a regular feed reader (or fetchable as portable XML). Items are resolved
 * from star keys through the same dedup identity the marks are stored under,
 * so each starred story appears once no matter how many panels carry a copy;
 * `?limit=` shares the panel endpoints' validation. Read-only, so like the
 * other GET feeds it carries no cross-site guard; errors stay JSON like the
 * panel RSS endpoint's.
 */
export function handleApiStarRss(c: Context, deps: ServerRouteDeps): Response {
  const limitResult = parseApiPanelItemsLimit(c.req.query("limit"));
  if (!limitResult.ok) return c.json({ error: limitResult.error }, 400);

  const rows = getStarredItems(limitResult.limit);
  const xml = renderStarredRss(rows, resolveRssFeedLinks(c.req.url, deps.basePath));
  return c.body(xml, 200, { "content-type": RSS_CONTENT_TYPE });
}
