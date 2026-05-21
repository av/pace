import { Database } from "bun:sqlite";
import { join, dirname } from "node:path";
import * as fs from "node:fs";
import type { ContentItem } from "./adapters/types";

let db: Database | null = null;
let currentDbPath: string | null = null;

export function getDb(): Database {
  const desiredPath = process.env.PACE_DB_PATH || join(process.cwd(), "data", "pace.db");
  if (!db || currentDbPath !== desiredPath) {
    if (db) {
      try { db.close(); } catch {}
      db = null;
    }
    fs.mkdirSync(dirname(desiredPath), { recursive: true });
    db = new Database(desiredPath, { create: true });
    currentDbPath = desiredPath;
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("PRAGMA busy_timeout=5000");
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

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_content_items_panel
      ON content_items(panel_id)
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_content_items_timestamp
      ON content_items(timestamp DESC)
    `);
  } catch (e: any) {
    throw new Error(`db: init failed for ${currentDbPath || 'default'}: ${e.message || e}`);
  }
}

export function saveItems(panelId: string, items: ContentItem[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO content_items (id, panel_id, title, url, source, body, timestamp, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      source = excluded.source,
      body = excluded.body,
      timestamp = excluded.timestamp,
      fetched_at = datetime('now')
  `);

  const tx = db.transaction(() => {
    for (const item of items) {
      try {
        stmt.run(
          item.id,
          panelId,
          item.title,
          item.url,
          item.source,
          item.body ?? null,
          item.timestamp.toISOString()
        );
      } catch (e: any) {
        throw new Error(`db: failed to save item id=${item.id} for panel=${panelId}: ${e.message || e}`);
      }
    }
  });

  try {
    tx();
  } catch (e: any) {
    if (e.message && e.message.startsWith('db:')) throw e;
    throw new Error(`db: failed to save ${items.length} items for panel ${panelId}: ${e.message || e}`);
  }
}

export function getRecentItems(limit: number = 50): ContentItemRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM content_items
    WHERE id IN (
      SELECT id FROM content_items
      GROUP BY CASE WHEN url = '' THEN id ELSE lower(rtrim(url, '/')) END
      HAVING timestamp = MAX(timestamp)
    )
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as ContentItemRow[];
}

export function getItemsByPanel(panelId: string, limit: number = 50): ContentItemRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM content_items
    WHERE panel_id = ?
      AND id IN (
        SELECT id FROM content_items
        WHERE panel_id = ?
        GROUP BY CASE WHEN url = '' THEN id ELSE lower(rtrim(url, '/')) END
        HAVING timestamp = MAX(timestamp)
      )
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(panelId, panelId, limit) as ContentItemRow[];
}

export function getLastFetchedAt(panelId: string): string | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT MAX(fetched_at) as last_fetched FROM content_items WHERE panel_id = ?"
  ).get(panelId) as { last_fetched: string | null } | null;
  return row?.last_fetched ?? null;
}

export function getLastFetchedAtAll(): string | null {
  const db = getDb();
  const row = db.prepare(
    "SELECT MAX(fetched_at) as last_fetched FROM content_items"
  ).get() as { last_fetched: string | null } | null;
  return row?.last_fetched ?? null;
}

export function getAllItemsByPanel(panelId: string): ContentItemRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM content_items
    WHERE panel_id = ?
      AND id IN (
        SELECT id FROM content_items
        WHERE panel_id = ?
        GROUP BY CASE WHEN url = '' THEN id ELSE lower(rtrim(url, '/')) END
        HAVING timestamp = MAX(timestamp)
      )
    ORDER BY timestamp DESC
  `).all(panelId, panelId) as ContentItemRow[];
}

export function replacePanelItems(panelId: string, items: ContentItemRow[]): void {
  const db = getDb();

  const existing = db.prepare(
    "SELECT id, summary FROM content_items WHERE panel_id = ? AND summary IS NOT NULL"
  ).all(panelId) as { id: string; summary: string }[];
  const summaryMap = new Map(existing.map((r) => [r.id, r.summary]));

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM content_items WHERE panel_id = ?").run(panelId);
    const stmt = db.prepare(`
      INSERT INTO content_items (id, panel_id, title, url, source, body, timestamp, fetched_at, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      stmt.run(
        item.id,
        panelId,
        item.title,
        item.url,
        item.source,
        item.body,
        item.timestamp,
        item.fetched_at,
        item.summary ?? summaryMap.get(item.id) ?? null,
      );
    }
  });
  tx();
}

export function closeDb(): void {
  try { if (db) db.close(); } catch {}
  db = null;
  currentDbPath = null;
}

export function pruneOldItems(days: number = 30): number {
  const db = getDb();
  const res = db.prepare(`DELETE FROM content_items WHERE fetched_at < datetime('now', ?)`).run(`-${days} days`);
  return (res.changes as number) ?? 0;
}

export interface ContentItemRow {
  id: string;
  panel_id: string;
  title: string;
  url: string;
  source: string;
  body: string | null;
  timestamp: string;
  fetched_at: string;
  summary: string | null;
}
