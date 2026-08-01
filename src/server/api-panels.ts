import type { Context } from "hono";
import type { DashboardPanel } from "../layout/types";
import {
  DEFAULT_PANEL_LIMIT,
  getItemsByPanel,
  getLastFetchedAt,
  getRecentItems,
  loadDashboardPanelData,
  type ContentItemRow,
  type DashboardPanelSnapshot,
} from "../db";
import { parseJsonStringArray } from "../utils";
import type { ServerRouteDeps } from "./routes";

/**
 * Upper bound for the `?limit=` override on GET /api/panels/:panel. Keeps a
 * single request from asking SQLite for an unbounded row count.
 */
export const MAX_API_PANEL_ITEMS_LIMIT = 500;

/** JSON shape of one feed item as served by the panel API. */
export interface ApiPanelItem {
  id: string;
  title: string;
  url: string;
  source: string;
  timestamp: string;
  fetched_at: string;
  summary: string | null;
  body: string | null;
  score: number | null;
  origins: string[];
}

/** JSON shape of one row in the GET /api/panels listing. */
export interface ApiPanelSummary {
  id: string;
  name: string;
  sources: string[];
  item_count: number;
  last_refreshed_at: string | null;
}

/**
 * SQLite-style UTC datetime as stored in `fetched_at` ("YYYY-MM-DD HH:MM:SS",
 * getLastFetchedAt appends a bare "Z"). Neither variant is valid ISO 8601 -
 * the zone-less form is even parsed as LOCAL time by most consumers - so the
 * API converts them to strict "YYYY-MM-DDTHH:MM:SSZ" instead of leaking three
 * different timestamp formats in one payload. Anything else (already-ISO item
 * timestamps) passes through untouched.
 */
const SQLITE_UTC_DATETIME_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)Z?$/;

export function toApiTimestamp(value: string): string;
export function toApiTimestamp(value: string | null): string | null;
export function toApiTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const m = SQLITE_UTC_DATETIME_RE.exec(value);
  return m ? `${m[1]}T${m[2]}Z` : value;
}

/**
 * Project a stored row to the public API shape: internal bookkeeping columns
 * (panel_id, applied_transforms, owner_source) stay private, and the
 * JSON-encoded origins column is decoded to a real array.
 */
export function serializeApiPanelItem(row: ContentItemRow): ApiPanelItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    timestamp: row.timestamp,
    fetched_at: toApiTimestamp(row.fetched_at),
    summary: row.summary,
    body: row.body,
    score: row.score,
    origins: parseJsonStringArray(row.origins),
  };
}

export type ApiPanelLimitResult =
  | { ok: true; limit: number | undefined }
  | { ok: false; error: string };

/**
 * Validate the optional `?limit=` query param: a positive integer up to
 * {@link MAX_API_PANEL_ITEMS_LIMIT}. Absent → undefined (panel default).
 */
export function parseApiPanelItemsLimit(raw: string | undefined): ApiPanelLimitResult {
  if (raw === undefined) return { ok: true, limit: undefined };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: "limit must be a positive integer" };
  }
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_API_PANEL_ITEMS_LIMIT) {
    return {
      ok: false,
      error: `limit must be between 1 and ${MAX_API_PANEL_ITEMS_LIMIT}`,
    };
  }
  return { ok: true, limit };
}

/**
 * Resolve an /api/panels/:panel param to its dashboard panel, accepting the
 * panel display name or the panel id — same lookup order as the refresh route.
 */
export function resolveApiPanel(
  param: string,
  deps: Pick<ServerRouteDeps, "dashboardPanels" | "panelNameToId">,
): DashboardPanel | undefined {
  const panelId = deps.panelNameToId.get(param) ?? param;
  return deps.dashboardPanels.find((panel) => panel.pid === panelId);
}

/**
 * Load a panel snapshot for the API. The default-limit read shares the
 * dashboard's cached snapshot (same cache key as GET /); an explicit `?limit=`
 * override reads the database directly so client-chosen limits cannot grow
 * the snapshot cache beyond its config-bounded key set.
 */
export function loadApiPanelSnapshot(
  panel: DashboardPanel,
  limitOverride: number | undefined,
): DashboardPanelSnapshot {
  const defaultLimit = panel.panel.limit ?? DEFAULT_PANEL_LIMIT;
  if (limitOverride === undefined || limitOverride === defaultLimit) {
    return loadDashboardPanelData(panel.pid, panel.isAll, defaultLimit);
  }
  return {
    panelId: panel.pid,
    items: panel.isAll
      ? getRecentItems(limitOverride)
      : getItemsByPanel(panel.pid, limitOverride),
    lastRefreshedAt: getLastFetchedAt(panel.isAll ? undefined : panel.pid),
  };
}

/** GET /api/panels — list every dashboard panel with counts and refresh times. */
export function handleApiPanelList(c: Context, deps: ServerRouteDeps): Response {
  const panels: ApiPanelSummary[] = deps.dashboardPanels.map((panel) => {
    const snapshot = loadApiPanelSnapshot(panel, undefined);
    return {
      id: panel.pid,
      name: panel.panel.panel,
      sources: deps.panelIdToRefreshSourceNames.get(panel.pid) ?? [],
      item_count: snapshot.items.length,
      last_refreshed_at: toApiTimestamp(snapshot.lastRefreshedAt),
    };
  });
  return c.json({ panels });
}

/** GET /api/panels/:panel — one panel's deduped items as JSON. */
export function handleApiPanelItems(c: Context, deps: ServerRouteDeps): Response {
  const param = c.req.param("panel")!; // route pattern /api/panels/:panel guarantees presence
  const panel = resolveApiPanel(param, deps);
  if (!panel) return c.json({ error: `Unknown panel: ${param}` }, 404);

  const limitResult = parseApiPanelItemsLimit(c.req.query("limit"));
  if (!limitResult.ok) return c.json({ error: limitResult.error }, 400);

  const snapshot = loadApiPanelSnapshot(panel, limitResult.limit);
  return c.json({
    id: panel.pid,
    name: panel.panel.panel,
    last_refreshed_at: toApiTimestamp(snapshot.lastRefreshedAt),
    items: snapshot.items.map(serializeApiPanelItem),
  });
}
