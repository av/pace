import { test, expect } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import {
  getDb,
  initDb,
  closeDb,
  saveItems,
  getItemsByPanel,
  getAllItemsByPanel,
  getRawItemsByPanel,
  getRecentItems,
  replacePanelItems,
  contentItemToRow,
  type ContentItemRow,
} from "./db";
import { makeContentItem as makeItem } from "./test/content-items";

installTempDbHooks({ prefix: "pace-sharedpanel-", init: false });

function panelPkOrdinal(): number {
  const cols = getDb().prepare("PRAGMA table_info(content_items)").all() as {
    name: string;
    pk: number;
  }[];
  return cols.find((c) => c.name === "panel_id")!.pk;
}

// --- Regression: one source feeding two panels must not steal items ---

test("saveItems to two panels keeps items on both (no panel_id steal)", () => {
  initDb();
  const items = [
    makeItem({ id: "s1", url: "https://ex.com/s1" }),
    makeItem({ id: "s2", url: "https://ex.com/s2" }),
  ];
  // Mirrors scheduler saveItemsToPanels: same source items saved per panel.
  saveItems("panelA", items);
  saveItems("panelB", items);

  expect(getItemsByPanel("panelA").map((r) => r.id).sort()).toEqual(["s1", "s2"]);
  expect(getItemsByPanel("panelB").map((r) => r.id).sort()).toEqual(["s1", "s2"]);
});

test("repeated refreshes upsert in place per panel without moving rows", () => {
  initDb();
  const first = [makeItem({ id: "s1", title: "old title", url: "https://ex.com/s1" })];
  saveItems("panelA", first);
  saveItems("panelB", first);
  // Next refresh cycle: updated content, both panels saved again.
  const second = [makeItem({ id: "s1", title: "new title", url: "https://ex.com/s1" })];
  saveItems("panelA", second);
  saveItems("panelB", second);

  const a = getItemsByPanel("panelA");
  const b = getItemsByPanel("panelB");
  expect(a.map((r) => r.title)).toEqual(["new title"]);
  expect(b.map((r) => r.title)).toEqual(["new title"]);
  // Exactly one row per panel - no duplicates from the upsert.
  expect(getRawItemsByPanel("panelA").length).toBe(1);
  expect(getRawItemsByPanel("panelB").length).toBe(1);
});

test("panel-scoped deduped read never leaks the sibling panel's copy", () => {
  initDb();
  const item = makeItem({ id: "s1", url: "https://ex.com/s1" });
  saveItems("panelA", [item]);
  saveItems("panelB", [item]);

  for (const pid of ["panelA", "panelB"]) {
    const rows = getAllItemsByPanel(pid);
    expect(rows.length).toBe(1);
    expect(rows[0]!.panel_id).toBe(pid);
  }
});

test("all-panels view collapses per-panel copies to one row", () => {
  initDb();
  const withUrl = makeItem({ id: "s1", url: "https://ex.com/s1" });
  const noUrl = makeItem({ id: "s2", url: "" });
  saveItems("panelA", [withUrl, noUrl]);
  saveItems("panelB", [withUrl, noUrl]);

  const recent = getRecentItems(10);
  expect(recent.map((r) => r.id).sort()).toEqual(["s1", "s2"]);
});

test("replacePanelItems on one panel leaves the sibling panel's copies intact", () => {
  initDb();
  const item = makeItem({ id: "s1", url: "https://ex.com/s1" });
  saveItems("panelA", [item]);
  saveItems("panelB", [item]);

  const replacement: ContentItemRow = contentItemToRow(
    makeItem({ id: "p1", url: "https://ex.com/p1" }),
  );
  replacement.panel_id = "panelA";
  replacePanelItems("panelA", [replacement]);

  expect(getItemsByPanel("panelA").map((r) => r.id)).toEqual(["p1"]);
  expect(getItemsByPanel("panelB").map((r) => r.id)).toEqual(["s1"]);
});

// --- Migration of legacy databases (sole-id primary key) ---

function createLegacyDb(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE content_items (
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
  db.exec("CREATE INDEX idx_content_items_panel ON content_items(panel_id)");
}

test("initDb migrates a legacy sole-id-PK database and preserves rows", () => {
  createLegacyDb();
  getDb()
    .prepare(
      `INSERT INTO content_items (id, panel_id, title, url, source, body, timestamp, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("legacy1", "panelA", "t", "https://ex.com/l1", "src", "b", "2024-01-01T00:00:00.000Z", "sum");

  expect(panelPkOrdinal()).toBe(0);
  initDb();
  expect(panelPkOrdinal()).toBe(2);

  const rows = getRawItemsByPanel("panelA");
  expect(rows.length).toBe(1);
  expect(rows[0]!).toMatchObject({
    id: "legacy1",
    panel_id: "panelA",
    title: "t",
    summary: "sum",
    origins: null,
    applied_transforms: null,
    score: null,
  });

  // Post-migration, the composite key actually holds: two panels, one id.
  const item = makeItem({ id: "legacy1", url: "https://ex.com/l1" });
  saveItems("panelB", [item]);
  expect(getRawItemsByPanel("panelA").length).toBe(1);
  expect(getRawItemsByPanel("panelB").length).toBe(1);
});

test("initDb migrates a legacy DB that already has the extra columns", () => {
  const db = getDb();
  createLegacyDb();
  db.exec("ALTER TABLE content_items ADD COLUMN origins TEXT");
  db.exec("ALTER TABLE content_items ADD COLUMN applied_transforms TEXT");
  db.exec("ALTER TABLE content_items ADD COLUMN score REAL");
  db.prepare(
    `INSERT INTO content_items (id, panel_id, title, url, source, timestamp, origins, applied_transforms, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("l2", "p", "t", "u", "s", "2024-01-01T00:00:00.000Z", '["a"]', '["dedupe"]', 7.5);

  initDb();
  expect(panelPkOrdinal()).toBe(2);
  const row = getRawItemsByPanel("p")[0]!;
  expect(row.origins).toBe('["a"]');
  expect(row.applied_transforms).toBe('["dedupe"]');
  expect(row.score).toBe(7.5);
});

test("initDb migrates the oldest schema variant (adapter_name column)", () => {
  const db = getDb();
  db.exec(`
    CREATE TABLE content_items (
      id TEXT NOT NULL PRIMARY KEY,
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
  db.prepare(
    `INSERT INTO content_items (id, adapter_name, title, url, source, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("old1", "hn", "t", "u", "s", "2024-01-01T00:00:00.000Z");

  initDb();
  expect(panelPkOrdinal()).toBe(2);
  expect(getRawItemsByPanel("hn").map((r) => r.id)).toEqual(["old1"]);
});

test("initDb is idempotent on an already-migrated database", () => {
  initDb();
  saveItems("panelA", [makeItem({ id: "s1", url: "https://ex.com/s1" })]);
  closeDb();
  initDb();
  initDb();
  expect(panelPkOrdinal()).toBe(2);
  expect(getRawItemsByPanel("panelA").length).toBe(1);
});
