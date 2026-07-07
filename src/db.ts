import { Database } from "bun:sqlite";
import { join, dirname } from "node:path";
import * as fs from "node:fs";
import type { ContentItem, ContentItemFields } from "./adapters/types";
import type { DashboardPanel } from "./layout/types";
import { warnDbClose } from "./db-warn";
import { errorMessage } from "./utils";

let db: Database | null = null;
let currentDbPath: string | null = null;

/** Re-throw per-item db: errors; wrap transaction failures with context. */
function rethrowDbTxError(e: unknown, wrapped: string): never {
  if (e instanceof Error && e.message.startsWith("db:")) throw e;
  throw new Error(`${wrapped}: ${errorMessage(e)}`);
}

function runItemOp(
  panelId: string,
  item: { id: string },
  verb: "save" | "replace",
  op: () => void,
): void {
  try {
    op();
  } catch (e: unknown) {
    throw new Error(`db: failed to ${verb} item id=${item.id} for panel=${panelId}: ${errorMessage(e)}`);
  }
}

function runPanelItemsTx(
  panelId: string,
  itemCount: number,
  verb: "save" | "replace",
  body: () => void,
): void {
  const db = getDb();
  const tx = db.transaction(body);
  try {
    tx();
  } catch (e: unknown) {
    rethrowDbTxError(e, `db: failed to ${verb} ${itemCount} items for panel ${panelId}`);
  }
}

/** Six identity columns plus ISO timestamp shared by row conversion and INSERT binding. */
export type CoreContentItemFields = Pick<
  ContentItemRow,
  "id" | "title" | "url" | "source" | "body"
> & { timestamp: string };

type CoreContentItemSource = Pick<ContentItemFields, "id" | "title" | "url" | "source"> & {
  body?: string | null;
  timestamp: Date | string;
};

/** Normalize adapter items or persisted rows into the seven core INSERT columns (minus panel_id). */
export function coreContentItemFields(source: CoreContentItemSource): CoreContentItemFields {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    source: source.source,
    body: source.body ?? null,
    timestamp: source.timestamp instanceof Date ? source.timestamp.toISOString() : source.timestamp,
  };
}

/** Seven core INSERT columns shared by saveItems and replacePanelItems. */
function bindCoreContentItemParams(
  panelId: string,
  item: CoreContentItemSource,
): [string, string, string, string, string, string | null, string] {
  const core = coreContentItemFields(item);
  return [core.id, panelId, core.title, core.url, core.source, core.body, core.timestamp];
}

/** Optional panel_id filter for queries scoped to one panel or all panels. */
function panelIdWhereClause(panelId?: string): { where: string; params: (string | number)[] } {
  if (panelId != null) {
    return { where: "WHERE panel_id = ?", params: [panelId] };
  }
  return { where: "", params: [] };
}

export function getDb(): Database {
  const desiredPath = process.env.PACE_DB_PATH || join(process.cwd(), "data", "pace.db");
  if (!db || currentDbPath !== desiredPath) {
    if (db) {
      try {
        db.close();
      } catch (err) {
        warnDbClose(err);
      }
      db = null;
    }
    try {
      fs.mkdirSync(dirname(desiredPath), { recursive: true });
      db = new Database(desiredPath, { create: true });
      currentDbPath = desiredPath;
      db.exec("PRAGMA journal_mode=WAL");
      db.exec("PRAGMA foreign_keys=ON");
      db.exec("PRAGMA busy_timeout=5000");
    } catch (e: unknown) {
      db = null;
      currentDbPath = null;
      throw new Error(`db: failed to open ${desiredPath}: ${errorMessage(e)}`);
    }
  }
  return db!;
}

export function initDb(): void {
  const db = getDb();

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT NOT NULL PRIMARY KEY,
        panel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        body TEXT,
        timestamp TEXT NOT NULL,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        summary TEXT
      )
    `);

    const cols = db.prepare("PRAGMA table_info(content_items)").all() as { name: string }[];
    if (cols.some((c) => c.name === "adapter_name")) {
      db.exec("ALTER TABLE content_items RENAME COLUMN adapter_name TO panel_id");
      db.exec("DROP INDEX IF EXISTS idx_content_items_adapter");
    }
    if (!cols.some((c) => c.name === "origins")) {
      db.exec("ALTER TABLE content_items ADD COLUMN origins TEXT");
    }
    if (!cols.some((c) => c.name === "applied_transforms")) {
      db.exec("ALTER TABLE content_items ADD COLUMN applied_transforms TEXT");
    }
    if (!cols.some((c) => c.name === "score")) {
      db.exec("ALTER TABLE content_items ADD COLUMN score REAL");
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_content_items_panel
      ON content_items(panel_id)
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_content_items_timestamp
      ON content_items(timestamp DESC)
    `);
  } catch (e: unknown) {
    throw new Error(`db: failed to init ${currentDbPath || "default"}: ${errorMessage(e)}`);
  }
}

export function saveItems(panelId: string, items: ContentItem[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO content_items (id, panel_id, title, url, source, body, timestamp, fetched_at, origins)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET
      panel_id = excluded.panel_id,
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      body = excluded.body,
      timestamp = excluded.timestamp,
      fetched_at = datetime('now'),
      origins = excluded.origins
  `);

  runPanelItemsTx(panelId, items.length, "save", () => {
    for (const item of items) {
      runItemOp(panelId, item, "save", () => {
        const origins = JSON.stringify([item.source]);
        stmt.run(...bindCoreContentItemParams(panelId, item), origins);
      });
    }
  });
}

const DEDUP_GROUP_EXPR = `CASE WHEN url = '' THEN id ELSE lower(rtrim(url, '/')) END`;

function dedupWinnerSubquery(panelFilter: string): string {
  // On a panel shared between an adapter and a pipeline consuming it, the raw
  // item and its pipeline copy (`pipeline:<name>:<id>`, see PIPELINE_ID_PREFIX
  // in scheduler-runtime.ts) share url/timestamp/fetched_at, so the tie must
  // prefer the pipeline copy - it carries the transformed/enriched fields.
  return `id IN (
    SELECT id FROM (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY ${DEDUP_GROUP_EXPR}
          ORDER BY timestamp DESC, fetched_at DESC, (id LIKE 'pipeline:%') DESC, id ASC
        ) AS rn
      FROM content_items
      ${panelFilter}
    ) WHERE rn = 1
  )`;
}

function getDedupedItems(
  panelId?: string,
  limit?: number,
  options: { excludePipelineOutput?: boolean } = {},
): ContentItemRow[] {
  const db = getDb();
  let { where: panelFilter, params } = panelIdWhereClause(panelId);
  if (options.excludePipelineOutput) {
    // Applied inside the dedup window too, so pipeline copies neither appear
    // in the result nor shadow their raw counterparts in the tie-break.
    const exclude = `id NOT LIKE 'pipeline:%'`;
    panelFilter = panelFilter ? `${panelFilter} AND ${exclude}` : `WHERE ${exclude}`;
  }
  let sql = `SELECT * FROM content_items WHERE ${dedupWinnerSubquery(panelFilter)} ORDER BY timestamp DESC`;
  if (limit != null) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  return db.prepare(sql).all(...params) as ContentItemRow[];
}

export const DEFAULT_PANEL_LIMIT = 50;

export function getRecentItems(limit: number = DEFAULT_PANEL_LIMIT): ContentItemRow[] {
  return getDedupedItems(undefined, limit);
}

export function getItemsByPanel(panelId: string, limit: number = DEFAULT_PANEL_LIMIT): ContentItemRow[] {
  return getDedupedItems(panelId, limit);
}

export interface DashboardPanelSnapshot {
  panelId: string;
  items: ContentItemRow[];
  lastRefreshedAt: string | null;
}

export function loadDashboardPanelData(
  panelId: string,
  isAll: boolean,
  limit: number,
): DashboardPanelSnapshot {
  return {
    panelId,
    items: isAll ? getRecentItems(limit) : getItemsByPanel(panelId, limit),
    lastRefreshedAt: getLastFetchedAt(isAll ? undefined : panelId),
  };
}

export function loadDashboardPanelDataMap(
  dashboardPanels: readonly DashboardPanel[],
): Map<string, DashboardPanelSnapshot> {
  const panelData = new Map<string, DashboardPanelSnapshot>();
  for (const { panel, pid, isAll } of dashboardPanels) {
    const limit = panel.limit ?? DEFAULT_PANEL_LIMIT;
    panelData.set(panel.panel, loadDashboardPanelData(pid, isAll, limit));
  }
  return panelData;
}

export function getLastFetchedAt(panelId?: string): string | null {
  const db = getDb();
  const { where, params } = panelIdWhereClause(panelId);
  const row = db
    .prepare(`SELECT MAX(fetched_at) as last_fetched FROM content_items ${where}`)
    .get(...params) as { last_fetched: string | null } | null;
  const val = row?.last_fetched ?? null;
  // SQLite datetime('now') returns UTC without a 'Z' suffix (e.g. "2026-06-15 00:57:04").
  // new Date() would parse that as local time, causing the panel-refreshed
  // relative timestamp to be off by the local UTC offset. Appending 'Z'
  // ensures correct UTC interpretation.
  if (val && !val.endsWith("Z")) return val + "Z";
  return val;
}

export function getAllItemsByPanel(panelId: string): ContentItemRow[] {
  return getDedupedItems(panelId);
}

/**
 * All raw rows for a panel, without URL dedup. Needed when rewriting a panel
 * (e.g. a pipeline retaining foreign items across a replace): a deduped read
 * would collapse a raw item and its pipeline copy into one winner and the
 * loser would be silently dropped by the rewrite.
 */
export function getRawItemsByPanel(panelId: string): ContentItemRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM content_items WHERE panel_id = ? ORDER BY timestamp DESC")
    .all(panelId) as ContentItemRow[];
}

/**
 * Deduped panel read that ignores pipeline output rows entirely. Used when
 * gathering pipeline input from a panel shared with pipeline output: the
 * dedup tie-break prefers pipeline copies, so a plain deduped read would hide
 * the raw item behind its own transformed copy and starve the pipeline.
 */
export function getPipelineInputItemsByPanel(panelId: string): ContentItemRow[] {
  return getDedupedItems(panelId, undefined, { excludePipelineOutput: true });
}

export function replacePanelItems(panelId: string, items: ContentItemRow[]): void {
  const db = getDb();

  const existing = db.prepare(
    "SELECT id, summary FROM content_items WHERE panel_id = ? AND summary IS NOT NULL"
  ).all(panelId) as { id: string; summary: string }[];
  const summaryMap = new Map(existing.map((r) => [r.id, r.summary]));

  runPanelItemsTx(panelId, items.length, "replace", () => {
    db.prepare("DELETE FROM content_items WHERE panel_id = ?").run(panelId);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO content_items (id, panel_id, title, url, source, body, timestamp, fetched_at, summary, origins, applied_transforms, score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      runItemOp(panelId, item, "replace", () => {
        stmt.run(
          ...bindCoreContentItemParams(panelId, item),
          item.fetched_at,
          item.summary ?? summaryMap.get(item.id) ?? null,
          item.origins ?? null,
          item.applied_transforms ?? null,
          item.score ?? null,
        );
      });
    }
  });
}

export function closeDb(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      warnDbClose(err);
    }
  }
  db = null;
  currentDbPath = null;
}

export function pruneOldItems(days: number = 30): number {
  const db = getDb();
  const res = db.prepare(`DELETE FROM content_items WHERE fetched_at < datetime('now', ?)`).run(`-${days} days`);
  return res.changes;
}

export interface ContentItemRow extends ContentItemFields {
  panel_id: string;
  body: string | null;
  timestamp: string;
  fetched_at: string;
  summary: string | null;
  /** JSON-encoded string[] of adapter/feed source names that contributed this item. */
  origins: string | null;
  /** JSON-encoded string[] of transform type strings applied to this item. */
  applied_transforms: string | null;
  /** Relevance score assigned by llm-rank (0-10); null if not ranked. */
  score: number | null;
}

export function contentRowToItem(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    timestamp: new Date(row.timestamp),
    body: row.body ?? undefined,
  };
}

export function contentItemToRow(item: ContentItem, base?: ContentItemRow): ContentItemRow {
  const core = coreContentItemFields(item);
  return {
    ...core,
    panel_id: base?.panel_id ?? "merged",
    fetched_at: base?.fetched_at ?? new Date().toISOString(),
    summary: base?.summary ?? (item.body ?? null),
    origins: base?.origins ?? null,
    applied_transforms: base?.applied_transforms ?? null,
    score: base?.score ?? null,
  };
}

export function contentRowsToItems(rows: readonly ContentItemRow[]): ContentItem[] {
  return rows.map(contentRowToItem);
}

export function contentRowMapById(rows: readonly ContentItemRow[]): Map<string, ContentItemRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

export function filterRowsByItemIds(
  rows: readonly ContentItemRow[],
  items: Iterable<{ id: string }>,
): ContentItemRow[] {
  const keepIds = new Set([...items].map((item) => item.id));
  return rows.filter((row) => keepIds.has(row.id));
}

export function contentItemsToRows(
  items: readonly ContentItem[],
  rowById: Map<string, ContentItemRow>,
): ContentItemRow[] {
  return items.map((item) => {
    const baseRow = rowById.get(item.id) ?? rowById.get(item.id.split("+")[0]);
    return contentItemToRow(item, baseRow);
  });
}
