import { test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ContentItem } from "./adapters/types";
import {
  getDb,
  initDb,
  saveItems,
  closeDb,
  getRecentItems,
  getItemsByPanel,
  getAllItemsByPanel,
  getLastFetchedAt,
  getLastFetchedAtAll,
  pruneOldItems,
  type ContentItemRow,
} from "./db";
import * as utilsMod from "./utils";

type ContentItemUpsertRow = Pick<ContentItemRow, "id" | "panel_id" | "title" | "url" | "fetched_at">;

let tempDir: string;
let dbPath: string;
let origEnv: string | undefined;

function makeItem(overrides: Partial<ContentItem> & { id: string; panel_id?: never }): ContentItem {
  const now = new Date();
  return {
    id: overrides.id,
    title: overrides.title ?? `title-${overrides.id}`,
    url: overrides.url ?? `https://ex.com/${overrides.id}`,
    source: overrides.source ?? "testsrc",
    timestamp: overrides.timestamp ?? now,
    body: overrides.body ?? null,
    summary: overrides.summary,
  };
}

beforeEach(() => {
  origEnv = process.env.PACE_DB_PATH;
  tempDir = mkdtempSync(join(tmpdir(), "pace-dbtest-"));
  dbPath = join(tempDir, "test.db");
  process.env.PACE_DB_PATH = dbPath;
  // ensure clean singleton
  closeDb();
});

afterEach(() => {
  closeDb();
  if (origEnv === undefined) {
    delete process.env.PACE_DB_PATH;
  } else {
    process.env.PACE_DB_PATH = origEnv;
  }
  try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
});

test("initDb creates table and indexes without error", () => {
  expect(() => initDb()).not.toThrow();
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_items'").all();
  expect(tables.length).toBe(1);
});

test("saveItems and getRecentItems dedup by normalized url keeping latest timestamp", () => {
  initDb();
  const older = makeItem({ id: "i1", url: "https://ex.com/a/", timestamp: new Date("2020-01-01") });
  const newer = makeItem({ id: "i2", url: "https://ex.com/a", timestamp: new Date("2020-01-02") }); // norm same (rtrim /)
  const other = makeItem({ id: "i3", url: "https://ex.com/b", timestamp: new Date("2020-01-03") });
  saveItems("p1", [older, newer, other]);

  const recent = getRecentItems(10);
  expect(recent.length).toBe(2);
  const ids = recent.map(r => r.id).sort();
  expect(ids).toEqual(["i2", "i3"]);
  // latest wins for dup url
  const dupRow = recent.find(r => r.id === "i2");
  expect(dupRow?.url).toBe("https://ex.com/a");
  expect(new Date(dupRow!.timestamp).getTime()).toBeGreaterThan(new Date(older.timestamp).getTime());
});

test("getItemsByPanel returns only for that panel and dedups within panel", () => {
  initDb();
  const a1 = makeItem({ id: "a1", url: "https://ex.com/x", timestamp: new Date("2021-01-01") });
  const a2 = makeItem({ id: "a2", url: "https://ex.com/x/", timestamp: new Date("2021-01-02") }); // dup norm
  const b1 = makeItem({ id: "b1", url: "https://ex.com/y", timestamp: new Date("2021-01-03") });
  saveItems("p1", [a1, a2]);
  saveItems("p2", [b1]);

  const p1 = getItemsByPanel("p1", 10);
  expect(p1.length).toBe(1);
  expect(p1[0].id).toBe("a2");
  expect(p1[0].panel_id).toBe("p1");

  const p2 = getItemsByPanel("p2", 10);
  expect(p2.length).toBe(1);
  expect(p2[0].id).toBe("b1");
});

test("getAllItemsByPanel returns all (no limit) deduped for panel", () => {
  initDb();
  const items = [
    makeItem({ id: "c1", url: "https://ex.com/z", timestamp: new Date("2022-01-01") }),
    makeItem({ id: "c2", url: "https://ex.com/z/", timestamp: new Date("2022-01-02") }),
    makeItem({ id: "c3", url: "https://ex.com/w", timestamp: new Date("2022-01-03") }),
  ];
  saveItems("p9", items);

  const all = getAllItemsByPanel("p9");
  expect(all.length).toBe(2);
  const ids = all.map(r => r.id).sort();
  expect(ids).toEqual(["c2", "c3"]);
  expect(all.every(r => r.panel_id === "p9")).toBe(true);
});

test("getRecentItems and panel getters respect limit", () => {
  initDb();
  const many = Array.from({ length: 5 }, (_, i) => makeItem({ id: `m${i}`, url: `https://ex.com/m${i}`, timestamp: new Date(2023, 0, i) }));
  saveItems("plim", many);

  expect(getRecentItems(2).length).toBe(2);
  expect(getItemsByPanel("plim", 3).length).toBe(3);
});

test("getLastFetchedAt / getLastFetchedAtAll return recent fetched_at or null", () => {
  initDb();
  expect(getLastFetchedAt("nope")).toBeNull();
  expect(getLastFetchedAtAll()).toBeNull();

  saveItems("pf", [makeItem({ id: "f1", url: "https://f", timestamp: new Date() })]);
  const lastP = getLastFetchedAt("pf");
  expect(lastP).not.toBeNull();
  expect(typeof lastP).toBe("string");

  const lastAll = getLastFetchedAtAll();
  expect(lastAll).not.toBeNull();
});

test("pruneOldItems deletes old rows and returns change count", () => {
  initDb();
  const old = makeItem({ id: "old1", url: "https://old", timestamp: new Date("2000-01-01") });
  const fresh = makeItem({ id: "new1", url: "https://new", timestamp: new Date() });
  saveItems("ppr", [old, fresh]);

  // backdate fetched_at on the 'old' row (save always uses now) so prune sees it as aged
  const db = getDb();
  db.prepare("UPDATE content_items SET fetched_at = datetime('now', '-10 days') WHERE id = ?").run("old1");

  // prune > 1 day old
  const changes = pruneOldItems(1);
  expect(changes).toBeGreaterThanOrEqual(1);

  const remaining = getAllItemsByPanel("ppr");
  expect(remaining.length).toBe(1);
  expect(remaining[0].id).toBe("new1");
});

test("empty results for unknown panel or no data", () => {
  initDb();
  expect(getRecentItems(5).length).toBe(0);
  expect(getItemsByPanel("unknown", 5).length).toBe(0);
  expect(getAllItemsByPanel("unknown").length).toBe(0);
});

test("saveItems handles items with empty url (falls back to id for dedup key)", () => {
  initDb();
  const noUrl1 = makeItem({ id: "nu1", url: "", timestamp: new Date("2024-01-01") });
  const noUrl2 = makeItem({ id: "nu2", url: "", timestamp: new Date("2024-01-02") });
  saveItems("pnu", [noUrl1, noUrl2]);

  const res = getRecentItems(10);
  // both kept since different id keys when url==''
  expect(res.length).toBe(2);
  const ids = res.map(r => r.id).sort();
  expect(ids).toEqual(["nu1", "nu2"]);
});

test("saveItems upsert by id updates panel_id (and all fields) from last save even cross-panel", () => {
  initDb();
  const first = makeItem({ id: "upsert1", url: "https://ex.com/upsert/a", timestamp: new Date("2020-01-01"), title: "first" });
  saveItems("panelA", [first]);
  const second = makeItem({ id: "upsert1", url: "https://ex.com/upsert/b", timestamp: new Date("2020-01-02"), title: "second" });
  saveItems("panelB", [second]);
  const dbh = getDb();
  const row = dbh
    .prepare("SELECT id, panel_id, title, url, fetched_at FROM content_items WHERE id = ?")
    .get("upsert1") as ContentItemUpsertRow | undefined;
  expect(row).toBeTruthy();
  expect(row.panel_id).toBe("panelB");
  expect(row.title).toBe("second");
  expect(row.url).toBe("https://ex.com/upsert/b");
  expect(row.fetched_at).toBeTruthy();
});

test("initDb failure uses errorMessage in thrown message", () => {
  initDb();
  const database = getDb();
  const emSpy = spyOn(utilsMod, "errorMessage");
  const execSpy = spyOn(database, "exec").mockImplementation(() => {
    throw new Error("schema exec fail");
  });
  try {
    expect(() => initDb()).toThrow(/db: failed to init.*schema exec fail/);
    expect(emSpy).toHaveBeenCalled();
  } finally {
    execSpy.mockRestore();
    emSpy.mockRestore();
  }
});

test("saveItems per-item failure uses errorMessage in thrown message", () => {
  initDb();
  const database = getDb();
  const emSpy = spyOn(utilsMod, "errorMessage");
  const realPrepare = database.prepare.bind(database);
  const prepareSpy = spyOn(database, "prepare").mockImplementation((sql: unknown) => {
    const stmt = realPrepare(sql as string);
    if (typeof sql === "string" && sql.includes("INSERT INTO content_items")) {
      spyOn(stmt, "run").mockImplementation(() => {
        throw new Error("insert fail");
      });
    }
    return stmt;
  });
  try {
    expect(() => saveItems("perr", [makeItem({ id: "bad1" })])).toThrow(
      /db: failed to save item id=bad1 for panel=perr: insert fail/,
    );
    expect(emSpy).toHaveBeenCalled();
  } finally {
    prepareSpy.mockRestore();
    emSpy.mockRestore();
  }
});

test("closeDb warns with errorMessage when db.close throws", () => {
  initDb();
  const database = getDb();
  const warnSpy = spyOn(console, "warn");
  const emSpy = spyOn(utilsMod, "errorMessage");
  const closeSpy = spyOn(database, "close").mockImplementation(() => {
    throw new Error("close fail");
  });
  try {
    closeDb();
    expect(warnSpy).toHaveBeenCalledWith("db: failed to close: close fail");
    expect(emSpy).toHaveBeenCalled();
  } finally {
    closeSpy.mockRestore();
    emSpy.mockRestore();
    warnSpy.mockRestore();
  }
});
