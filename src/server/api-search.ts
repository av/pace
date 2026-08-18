import type { Context } from "hono";
import { searchItems, type ContentItemRow } from "../db";
import {
  parseApiPanelItemsLimit,
  resolveApiPanel,
  serializeApiPanelItem,
  type ApiPanelItem,
} from "./api-panels";
import type { ServerRouteDeps } from "./routes";

/** Default result cap for GET /api/search when `?limit=` is absent. */
export const DEFAULT_API_SEARCH_LIMIT = 50;

/**
 * JSON shape of one search hit: a panel API item plus the panel it lives on,
 * since search results span panels.
 */
export interface ApiSearchItem extends ApiPanelItem {
  panel: string;
}

export function serializeApiSearchItem(row: ContentItemRow): ApiSearchItem {
  return { ...serializeApiPanelItem(row), panel: row.panel_id };
}

/**
 * Split a raw `?q=` value into search terms: whitespace-separated,
 * empty-after-trim yields no terms. Matches the dashboard `/` filter bar's
 * tokenization so both frontends agree on what a query means.
 */
export function parseSearchTerms(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw.split(/\s+/).filter((term) => term.length > 0);
}

/**
 * GET /api/search?q=terms[&panel=id][&limit=N] — search stored items across
 * every panel (or one panel) for items matching ALL terms case-insensitively
 * in title, url, source, summary, or body. Same read-only JSON surface as
 * /api/panels, same deduped item set, newest first.
 */
export function handleApiSearch(c: Context, deps: ServerRouteDeps): Response {
  const terms = parseSearchTerms(c.req.query("q"));
  if (terms.length === 0) {
    return c.json({ error: "q is required and must contain at least one search term" }, 400);
  }

  const limitResult = parseApiPanelItemsLimit(c.req.query("limit"));
  if (!limitResult.ok) return c.json({ error: limitResult.error }, 400);
  const limit = limitResult.limit ?? DEFAULT_API_SEARCH_LIMIT;

  const panelParam = c.req.query("panel");
  let panelId: string | undefined;
  if (panelParam !== undefined) {
    const panel = resolveApiPanel(panelParam, deps);
    if (!panel) return c.json({ error: `Unknown panel: ${panelParam}` }, 404);
    // The "all recent items" panel spans every panel, same as no filter.
    panelId = panel.isAll ? undefined : panel.pid;
  }

  const rows = searchItems(terms, { panelId, limit });
  return c.json({
    query: terms.join(" "),
    count: rows.length,
    items: rows.map(serializeApiSearchItem),
  });
}
