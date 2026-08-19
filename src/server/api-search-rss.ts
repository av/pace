import type { Context } from "hono";
import type { ContentItemRow } from "../db";
import { searchItems } from "../db";
import { parseApiPanelItemsLimit, resolveApiPanel } from "./api-panels";
import {
  escapeXml,
  formatRssDate,
  renderRssItem,
  RSS_CONTENT_TYPE,
  type RssFeedLinks,
} from "./api-panels-rss";
import { DEFAULT_API_SEARCH_LIMIT, parseSearchQuery } from "./api-search";
import type { ServerRouteDeps } from "./routes";

/**
 * Render search hits as a complete RSS 2.0 document — a "saved search" feed.
 * The channel is titled after the query so multiple saved searches stay
 * distinguishable in a feed reader's subscription list.
 */
export function renderSearchRss(
  query: string,
  rows: ContentItemRow[],
  links: RssFeedLinks,
): string {
  const channelLines = [
    `<title>${escapeXml(`pace search: ${query}`)}</title>`,
    `<link>${escapeXml(links.siteUrl)}</link>`,
    `<atom:link href="${escapeXml(links.feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `<description>${escapeXml(`Items matching "${query}" on pace`)}</description>`,
    `<generator>pace</generator>`,
  ];
  // Newest hit doubles as the build date; an empty result set omits it
  // rather than inventing a timestamp.
  const lastBuildDate = formatRssDate(rows[0]?.timestamp ?? null);
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
 * Derive the channel/self links for a search feed. Unlike a panel feed, the
 * query string IS the feed's identity (`?q=` and friends select the items),
 * so the self link keeps it instead of dropping it.
 */
export function resolveSearchRssFeedLinks(requestUrl: string, basePath: string): RssFeedLinks {
  const url = new URL(requestUrl);
  return {
    siteUrl: `${url.origin}${basePath === "" ? "/" : basePath}`,
    feedUrl: `${url.origin}${url.pathname}${url.search}`,
  };
}

/**
 * GET /api/search.rss?q=terms[&panel=id][&limit=N] — the same server-side
 * search as /api/search, rendered as an RSS 2.0 feed so any query becomes a
 * subscribable "saved search" in a regular feed reader. Same term semantics,
 * panel scoping, limit validation, and deduped newest-first item set as the
 * JSON endpoint; errors stay JSON like the panel RSS endpoint's.
 */
export function handleApiSearchRss(c: Context, deps: ServerRouteDeps): Response {
  const queryResult = parseSearchQuery(c.req.query("q"));
  if (!queryResult.ok) return c.json({ error: queryResult.error }, 400);
  const { terms, starred, seen, query } = queryResult.parsed;

  const limitResult = parseApiPanelItemsLimit(c.req.query("limit"));
  if (!limitResult.ok) return c.json({ error: limitResult.error }, 400);
  const limit = limitResult.limit ?? DEFAULT_API_SEARCH_LIMIT;

  const panelParam = c.req.query("panel");
  let panelId: string | undefined;
  if (panelParam !== undefined) {
    const panel = resolveApiPanel(panelParam, deps);
    if (!panel) return c.json({ error: `Unknown panel: ${panelParam}` }, 404);
    panelId = panel.isAll ? undefined : panel.pid;
  }

  const rows = searchItems(terms, { panelId, limit, starred, seen });
  const xml = renderSearchRss(
    query,
    rows,
    resolveSearchRssFeedLinks(c.req.url, deps.basePath),
  );
  return c.body(xml, 200, { "content-type": RSS_CONTENT_TYPE });
}
