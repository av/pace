import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { ContentItem } from "./adapters/types";

let db: Database;

export function getDb(): Database {
  if (!db) {
    const dbPath = join(process.cwd(), "data", "pace.db");
    db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA foreign_keys=ON");
  }
  return db;
}

export function initDb(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS content_items (
      id TEXT PRIMARY KEY,
      adapter_name TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      body TEXT,
      timestamp TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      summary TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_content_items_adapter
    ON content_items(adapter_name)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_content_items_timestamp
    ON content_items(timestamp DESC)
  `);
}

export function saveItems(adapterName: string, items: ContentItem[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO content_items (id, adapter_name, title, url, source, body, timestamp, fetched_at)
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
      stmt.run(
        item.id,
        adapterName,
        item.title,
        item.url,
        item.source,
        item.body ?? null,
        item.timestamp.toISOString()
      );
    }
  });

  tx();
}

export function getRecentItems(limit: number = 50): ContentItemRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM content_items
    WHERE id IN (
      SELECT id FROM content_items
      GROUP BY url
      HAVING id = MIN(id)
    )
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as ContentItemRow[];
}

export function getItemsByAdapter(adapterName: string, limit: number = 50): ContentItemRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM content_items
    WHERE adapter_name = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(adapterName, limit) as ContentItemRow[];
}

export interface ContentItemRow {
  id: string;
  adapter_name: string;
  title: string;
  url: string;
  source: string;
  body: string | null;
  timestamp: string;
  fetched_at: string;
  summary: string | null;
}
