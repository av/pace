import { Database } from "bun:sqlite";
import { join, dirname } from "node:path";
import * as fs from "node:fs";
import type { ContentItem, ContentItemFields } from "./adapters/types";
import type { DashboardPanel } from "./layout/types";
import { warnDb, warnDbClose } from "./db-warn";
import { clampFutureTimestamp, errorMessage } from "./utils";

let db: Database | null = null;
let currentDbPath: string | null = null;
/** Set by closeDb({ final: true }); makes getDb() fail loudly instead of re-opening. */
let dbFinalized = false;

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

/**
 * Convert an item timestamp to an ISO string, degrading Invalid Date
 * instances to "now" with a warning.
 *
 * Defense in depth: adapters are expected to parse feed dates via
 * parseFeedDate and friends, but a raw `new Date(garbage)` reaching here
 * would make .toISOString() throw inside the per-panel transaction and roll
 * back the WHOLE save — one malformed date drops every fetched item for the
 * source. Degrade per item instead.
 */
function timestampToIso(timestamp: Date | string, itemId: string): string {
  if (typeof timestamp === "string") return timestamp;
  if (Number.isNaN(timestamp.getTime())) {
    warnDb(`invalid Date timestamp on item id=${itemId}; falling back to now`);
    return new Date().toISOString();
  }
  return timestamp.toISOString();
}

/** Normalize adapter items or persisted rows into the seven core INSERT columns (minus panel_id). */
export function coreContentItemFields(source: CoreContentItemSource): CoreContentItemFields {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    source: source.source,
    body: source.body ?? null,
    // Clamp future-dated timestamps (clock-skewed feeds) so they can't
    // sort-pin to the top of panels and pipeline input indefinitely. Stored
    // rows are clamped at save time, so on rewrite paths (replacePanelItems,
    // contentItemToRow) this is a no-op backstop — except for future-dated
    // rows persisted by pre-clamp versions, which get fixed once here.
    timestamp: clampFutureTimestamp(timestampToIso(source.timestamp, source.id)),
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

/**
 * Normalize a fetched_at value to the canonical SQLite UTC format.
 *
 * saveItems writes datetime('now') ("YYYY-MM-DD HH:MM:SS"), but rows built in
 * JS (e.g. llm-merge output via contentItemToRow) used to carry ISO strings
 * ("...T...Z"). Since 'T' > ' ', mixed formats corrupt every string
 * comparison on the column: MAX(fetched_at) in getLastFetchedAt, the
 * `fetched_at DESC` dedup tie-break, and same-day pruneOldItems cutoffs.
 * Unparseable strings pass through untouched rather than being mangled.
 */
export function toDbFetchedAt(value: Date | string): string {
  if (typeof value === "string") {
    // Only convert ISO 'T' strings: space-separated variants are already
    // SQLite-style UTC, and new Date() would misparse them as local time.
    if (!value.includes("T")) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toISOString().slice(0, 19).replace("T", " ");
  }
  return value.toISOString().slice(0, 19).replace("T", " ");
}

/** Optional panel_id filter for queries scoped to one panel or all panels. */
function panelIdWhereClause(panelId?: string): { where: string; params: (string | number)[] } {
  if (panelId != null) {
    return { where: "WHERE panel_id = ?", params: [panelId] };
  }
  return { where: "", params: [] };
}

export function getDb(): Database {
  if (dbFinalized) {
    // Shutdown closed the DB for good (see closeDb final). A straggler writer
    // (e.g. a refresh that outlived the shutdown drain timeout) must fail
    // loudly here rather than silently re-open the database and race exit.
    throw new Error("db: database was closed for shutdown; refusing to re-open");
  }
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

/**
 * Rebuild content_items with a composite (id, panel_id) primary key.
 *
 * The original schema made `id` the sole primary key, so saveItems' upsert
 * (`panel_id = excluded.panel_id`) MOVED an item between panels whenever one
 * source fed two panels - each refresh stole the rows for whichever panel
 * saved last. With the composite key each panel owns its own copy of a row.
 * SQLite cannot alter a primary key in place, so legacy databases are
 * rebuilt via the documented copy/drop/rename dance inside one transaction.
 */
function migrateToCompositePrimaryKey(
  db: Database,
  cols: { name: string; pk: number }[],
): void {
  // Fresh tables (and already-migrated ones) have panel_id as pk ordinal 2.
  // Legacy tables have pk solely on id; the panel column may still carry its
  // pre-rename name `adapter_name` when `cols` was captured before the rename.
  const panelCol = cols.find((c) => c.name === "panel_id" || c.name === "adapter_name");
  if (!panelCol || panelCol.pk !== 0) return;

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE content_items_new (
        id TEXT NOT NULL,
        panel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        body TEXT,
        timestamp TEXT NOT NULL,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        summary TEXT,
        origins TEXT,
        applied_transforms TEXT,
        score REAL,
        owner_source TEXT,
        PRIMARY KEY (id, panel_id)
      )
    `);
    db.exec(`
      INSERT INTO content_items_new
        (id, panel_id, title, url, source, body, timestamp, fetched_at, summary, origins, applied_transforms, score, owner_source)
      SELECT id, panel_id, title, url, source, body, timestamp, fetched_at, summary, origins, applied_transforms, score, owner_source
      FROM content_items
    `);
    db.exec("DROP TABLE content_items");
    db.exec("ALTER TABLE content_items_new RENAME TO content_items");
  });
  tx();
}

export function initDb(): void {
  const db = getDb();

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_items (
        id TEXT NOT NULL,
        panel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        body TEXT,
        timestamp TEXT NOT NULL,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        summary TEXT,
        PRIMARY KEY (id, panel_id)
      )
    `);

    const cols = db.prepare("PRAGMA table_info(content_items)").all() as {
      name: string;
      pk: number;
    }[];
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
    if (!cols.some((c) => c.name === "owner_source")) {
      db.exec("ALTER TABLE content_items ADD COLUMN owner_source TEXT");
    }

    migrateToCompositePrimaryKey(db, cols);

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

export interface SaveItemsOptions {
  /**
   * Keep the already-stored timestamp when a row is updated (new rows still
   * use the incoming timestamp). Declarative adapters (e.g. bookmarks)
   * fabricate `now`-based timestamps on every fetch; without this, each
   * refresh re-stamps every item to "just now" and the panel never ages.
   */
  preserveStoredTimestamps?: boolean;
  /**
   * Config source name (adapter name) to record as the row owner. The
   * scheduler stamps this so adapter-level transforms on a panel shared by
   * several sources can be scoped to the saving source's own rows instead of
   * consuming (and then deleting) co-tenant rows. A null/absent value never
   * clears an already-stored owner.
   */
  ownerSource?: string;
}

export function saveItems(
  panelId: string,
  items: ContentItem[],
  options: SaveItemsOptions = {},
): void {
  const db = getDb();
  const timestampUpdate = options.preserveStoredTimestamps
    ? ""
    : "timestamp = excluded.timestamp,";
  const stmt = db.prepare(`
    INSERT INTO content_items (id, panel_id, title, url, source, body, timestamp, fetched_at, origins, owner_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)
    ON CONFLICT(id, panel_id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      body = excluded.body,
      ${timestampUpdate}
      fetched_at = datetime('now'),
      origins = excluded.origins,
      owner_source = COALESCE(excluded.owner_source, owner_source)
  `);

  // The future-timestamp clamp (see coreContentItemFields) must be STABLE
  // across refreshes: while the feed keeps serving the same future date,
  // re-clamping to a fresh "now" on every upsert would re-pin the item to
  // the top of the panel each cycle. If a sane (non-future) timestamp is
  // already stored for this row, it wins over a freshly clamped one.
  const existingTsStmt = db.prepare(
    `SELECT timestamp FROM content_items WHERE id = ? AND panel_id = ?`,
  );
  const now = Date.now();

  runPanelItemsTx(panelId, items.length, "save", () => {
    for (const item of items) {
      runItemOp(panelId, item, "save", () => {
        const iso = timestampToIso(item.timestamp, item.id);
        let timestamp = clampFutureTimestamp(iso, now);
        if (timestamp !== iso) {
          const existing = existingTsStmt.get(item.id, panelId) as { timestamp: string } | null;
          if (existing && clampFutureTimestamp(existing.timestamp, now) === existing.timestamp) {
            timestamp = existing.timestamp;
          }
        }
        const origins = JSON.stringify([item.source]);
        stmt.run(
          ...bindCoreContentItemParams(panelId, { ...item, timestamp }),
          origins,
          options.ownerSource ?? null,
        );
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
  //
  // Rows are keyed by rowid, not id: with the composite (id, panel_id)
  // primary key, one source feeding two panels stores the same id on both
  // panels, so an `id IN (...)` membership test would leak the sibling
  // panel's copy past the subquery's panel filter (and collapse legitimate
  // per-panel copies in the unfiltered all-panels view). The final
  // panel_id ASC leg keeps ties deterministic across those copies.
  return `rowid IN (
    SELECT rowid FROM (
      SELECT rowid,
        ROW_NUMBER() OVER (
          PARTITION BY ${DEDUP_GROUP_EXPR}
          ORDER BY timestamp DESC, fetched_at DESC, (id LIKE 'pipeline:%') DESC, id ASC, panel_id ASC
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

// --- Dashboard snapshot cache -----------------------------------------------
//
// Every GET / re-ran one window-function dedup query plus a MAX(fetched_at)
// scan PER PANEL, even though panel data only changes when a refresh writes
// (typically every 15 minutes). At ~20k stored rows a 10-panel dashboard
// spent ~22ms of SQLite work per request recomputing identical snapshots.
//
// Snapshots are cached per (panel, isAll, limit) and the whole cache is
// invalidated by a cheap write stamp: total_changes() covers every
// INSERT/UPDATE/DELETE on this connection (scheduler and server share the
// getDb() handle), and PRAGMA data_version covers commits from OTHER
// connections/processes on the same file. A new Database handle (closeDb,
// PACE_DB_PATH switch) also clears the cache via identity check.
//
// Memory is bounded: keys are the config-defined panels. Cached rows are
// only handed to read-only consumers (dashboard render, share export).
let snapshotCacheDb: Database | null = null;
let snapshotCacheStamp: string | null = null;
const snapshotCache = new Map<string, DashboardPanelSnapshot>();

/**
 * Number of cached dashboard snapshots. Diagnostics/tests: keys are
 * (panel, isAll, limit) tuples from the config-defined dashboard, so the size
 * must stay bounded by that key set in a long-running process — growth beyond
 * it means a caller is feeding unbounded client-controlled keys into the cache.
 */
export function dashboardSnapshotCacheSize(): number {
  return snapshotCache.size;
}

function dbWriteStamp(db: Database): string {
  const changes = (db.prepare("SELECT total_changes() AS c").get() as { c: number }).c;
  const version = (db.prepare("PRAGMA data_version").get() as { data_version: number })
    .data_version;
  return `${changes}:${version}`;
}

export function loadDashboardPanelData(
  panelId: string,
  isAll: boolean,
  limit: number,
): DashboardPanelSnapshot {
  const db = getDb();
  const stamp = dbWriteStamp(db);
  if (db !== snapshotCacheDb || stamp !== snapshotCacheStamp) {
    snapshotCache.clear();
    snapshotCacheDb = db;
    snapshotCacheStamp = stamp;
  }
  const key = `${panelId}|${isAll}|${limit}`;
  const cached = snapshotCache.get(key);
  if (cached) return cached;
  const snapshot: DashboardPanelSnapshot = {
    panelId,
    items: isAll ? getRecentItems(limit) : getItemsByPanel(panelId, limit),
    lastRefreshedAt: getLastFetchedAt(isAll ? undefined : panelId),
  };
  snapshotCache.set(key, snapshot);
  return snapshot;
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

/**
 * Delete rows on a panel whose id starts with `idPrefix` but is absent from
 * `keepIds`. Used for declarative adapters (config-defined item lists, e.g.
 * bookmarks): their fetch result IS the complete set, so rows left behind by
 * removed, reordered, or renamed config entries must not linger on the panel.
 * Prefix matching is positional (substr, not LIKE — no wildcard surprises),
 * so pipeline copies (`pipeline:<name>:<idPrefix>...`) never match.
 * Returns the number of deleted rows.
 */
export function prunePanelItemsByIdPrefix(
  panelId: string,
  idPrefix: string,
  keepIds: ReadonlySet<string>,
): number {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM content_items WHERE panel_id = ? AND substr(id, 1, ?) = ?")
    .all(panelId, idPrefix.length, idPrefix) as { id: string }[];
  const stale = rows.filter((r) => !keepIds.has(r.id));
  if (stale.length === 0) return 0;
  const del = db.prepare("DELETE FROM content_items WHERE panel_id = ? AND id = ?");
  const tx = db.transaction(() => {
    for (const row of stale) del.run(panelId, row.id);
  });
  try {
    tx();
  } catch (e: unknown) {
    rethrowDbTxError(e, `db: failed to prune ${stale.length} stale items for panel ${panelId}`);
  }
  return stale.length;
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
      INSERT OR REPLACE INTO content_items (id, panel_id, title, url, source, body, timestamp, fetched_at, summary, origins, applied_transforms, score, owner_source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      runItemOp(panelId, item, "replace", () => {
        stmt.run(
          ...bindCoreContentItemParams(panelId, item),
          toDbFetchedAt(item.fetched_at),
          item.summary ?? summaryMap.get(item.id) ?? null,
          item.origins ?? null,
          item.applied_transforms ?? null,
          item.score ?? null,
          item.owner_source ?? null,
        );
      });
    }
  });
}

/**
 * Close the database handle. With `final: true` (process shutdown, after the
 * scheduler drain) any later getDb() throws instead of silently re-opening -
 * a refresh that outlived the drain timeout would otherwise recreate the
 * handle right before exit and race it. A later plain closeDb() lifts the
 * seal (test harnesses close/re-open the DB between tests).
 */
export function closeDb(options: { final?: boolean } = {}): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      warnDbClose(err);
    }
  }
  db = null;
  currentDbPath = null;
  dbFinalized = options.final === true;
}

export function pruneOldItems(days: number = 30): number {
  // Guard the cutoff: a negative/NaN value builds an invalid SQLite modifier
  // (e.g. "--5 days" or "-NaN days"), making datetime() NULL and the DELETE a
  // silent no-op - retention would quietly stop working. Fail loudly instead.
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`db: pruneOldItems days must be a positive finite number (got ${days})`);
  }
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
  /**
   * Config source name that saved this row (see SaveItemsOptions.ownerSource).
   * Null for rows saved before attribution existed or synthesized outside a
   * source refresh; such rows are treated as unowned on shared panels.
   */
  owner_source: string | null;
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
    fetched_at: toDbFetchedAt(base?.fetched_at ?? new Date()),
    summary: base?.summary ?? (item.body ?? null),
    origins: base?.origins ?? null,
    applied_transforms: base?.applied_transforms ?? null,
    score: base?.score ?? null,
    owner_source: base?.owner_source ?? null,
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
