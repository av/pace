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
 * A parsed `?q=` value: text terms plus any `starred:yes|no` / `seen:yes|no`
 * operators.
 */
export interface ParsedSearchQuery {
  /** Plain text terms, operator tokens removed. */
  terms: string[];
  /** Star filter: true for `starred:yes`, false for `starred:no`, absent otherwise. */
  starred?: boolean;
  /** Seen filter: true for `seen:yes`, false for `seen:no`, absent otherwise. */
  seen?: boolean;
  /** Normalized query echo — terms in order with the operators lowercased. */
  query: string;
}

/**
 * Parse a raw `?q=` into terms and the optional `starred:yes|no` and
 * `seen:yes|no` operators (case-insensitive; repeated operators — last one
 * wins). A query of only operators is valid: "everything unseen" is a useful
 * search. Any other `starred:` / `seen:` value is an error rather than a
 * silent text term, so typos like `seen:ys` don't quietly search for that
 * literal string.
 */
export function parseSearchQuery(
  raw: string | undefined,
): { ok: true; parsed: ParsedSearchQuery } | { ok: false; error: string } {
  const tokens = parseSearchTerms(raw);
  const terms: string[] = [];
  let starred: boolean | undefined;
  let seen: boolean | undefined;
  for (const token of tokens) {
    const match = /^(starred|seen):(.*)$/i.exec(token);
    if (!match) {
      terms.push(token);
      continue;
    }
    const name = match[1].toLowerCase();
    const value = match[2].toLowerCase();
    let flag: boolean;
    if (value === "yes") flag = true;
    else if (value === "no") flag = false;
    else {
      return {
        ok: false,
        error: `Invalid ${name}: filter "${token}" — use ${name}:yes or ${name}:no`,
      };
    }
    if (name === "starred") starred = flag;
    else seen = flag;
  }
  if (terms.length === 0 && starred === undefined && seen === undefined) {
    return { ok: false, error: "q is required and must contain at least one search term" };
  }
  const query = [
    ...terms,
    ...(starred === undefined ? [] : [`starred:${starred ? "yes" : "no"}`]),
    ...(seen === undefined ? [] : [`seen:${seen ? "yes" : "no"}`]),
  ].join(" ");
  return { ok: true, parsed: { terms, starred, seen, query } };
}

/**
 * GET /api/search?q=terms[&panel=id][&limit=N] — search stored items across
 * every panel (or one panel) for items matching ALL terms case-insensitively
 * in title, url, source, summary, or body. `starred:yes` / `starred:no` and
 * `seen:yes` / `seen:no` in the query filter by star and seen state (an
 * operator-only query is valid — e.g. `seen:no` lists everything unread).
 * Same read-only JSON surface as /api/panels, same deduped item set,
 * newest first.
 */
export function handleApiSearch(c: Context, deps: ServerRouteDeps): Response {
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
    // The "all recent items" panel spans every panel, same as no filter.
    panelId = panel.isAll ? undefined : panel.pid;
  }

  const rows = searchItems(terms, { panelId, limit, starred, seen });
  return c.json({
    query,
    count: rows.length,
    items: rows.map(serializeApiSearchItem),
  });
}
