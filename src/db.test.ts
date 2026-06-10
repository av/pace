import { test, expect, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installTempDbHooks, tempDbFixture } from "./test/temp-db";
import {
  getDb,
  initDb,
  saveItems,
  closeDb,
  getRecentItems,
  getItemsByPanel,
  getAllItemsByPanel,
  getLastFetchedAt,
  loadDashboardPanelData,
  loadDashboardPanelDataMap,
  DEFAULT_PANEL_LIMIT,
  pruneOldItems,
  replacePanelItems,
  contentRowToItem,
  contentItemToRow,
  coreContentItemFields,
  contentRowsToItems,
  contentRowMapById,
  filterRowsByItemIds,
  contentItemsToRows,
  type ContentItemRow,
} from "./db";
import * as utilsMod from "./utils";
import {
  makeContentItem as makeItem,
  makeContentItemRow as makeRow,
} from "./test/content-items";

type ContentItemUpsertRow = Pick<ContentItemRow, "id" | "panel_id" | "title" | "url" | "fetched_at">;

installTempDbHooks({ prefix: "pace-dbtest-", init: false, warnOnRmFail: true });

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

test("getItemsByPanel dedups per panel while getRecentItems dedups globally", () => {
  initDb();
  const sharedUrl = "https://ex.com/shared";
  const p1Old = makeItem({ id: "s1", url: sharedUrl, timestamp: new Date("2021-01-01") });
  const p1New = makeItem({ id: "s2", url: `${sharedUrl}/`, timestamp: new Date("2021-01-02") });
  const p2Item = makeItem({ id: "s3", url: sharedUrl, timestamp: new Date("2021-01-03") });
  saveItems("p1", [p1Old, p1New]);
  saveItems("p2", [p2Item]);

  const panel1 = getItemsByPanel("p1", 10);
  expect(panel1.length).toBe(1);
  expect(panel1[0].id).toBe("s2");
  expect(panel1[0].panel_id).toBe("p1");

  const panel2 = getItemsByPanel("p2", 10);
  expect(panel2.length).toBe(1);
  expect(panel2[0].id).toBe("s3");
  expect(panel2[0].panel_id).toBe("p2");

  const recent = getRecentItems(10);
  expect(recent.length).toBe(1);
  expect(recent[0].id).toBe("s3");
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

test("loadDashboardPanelData routes all vs panel-scoped queries", () => {
  initDb();
  saveItems("scoped", [makeItem({ id: "s1", url: "https://scoped", timestamp: new Date() })]);
  saveItems("other", [makeItem({ id: "o1", url: "https://other", timestamp: new Date() })]);

  const scoped = loadDashboardPanelData("scoped", false, 10);
  expect(scoped.panelId).toBe("scoped");
  expect(scoped.items.map((item) => item.id)).toEqual(["s1"]);
  expect(scoped.lastRefreshedAt).not.toBeNull();

  const all = loadDashboardPanelData("scoped", true, 10);
  expect(all.panelId).toBe("scoped");
  expect(all.items.map((item) => item.id).sort()).toEqual(["o1", "s1"]);
  expect(all.lastRefreshedAt).not.toBeNull();
});

test("loadDashboardPanelDataMap loads each dashboard panel with default limit", () => {
  initDb();
  saveItems("tech-panel", [makeItem({ id: "t1", url: "https://tech", timestamp: new Date() })]);
  saveItems("other-panel", [makeItem({ id: "o1", url: "https://other", timestamp: new Date() })]);

  const panelData = loadDashboardPanelDataMap([
    { panel: { panel: "Tech", source: "hackernews", id: "tech-panel" }, pid: "tech-panel", isAll: false },
    { panel: { panel: "All", source: "all" }, pid: "all-panel", isAll: true },
  ]);

  expect(panelData.get("Tech")).toEqual({
    panelId: "tech-panel",
    items: expect.arrayContaining([expect.objectContaining({ id: "t1" })]),
    lastRefreshedAt: expect.any(String),
  });
  expect(panelData.get("Tech")?.items).toHaveLength(1);

  const all = panelData.get("All");
  expect(all?.panelId).toBe("all-panel");
  expect(all?.items.map((item) => item.id).sort()).toEqual(["o1", "t1"]);
  expect(DEFAULT_PANEL_LIMIT).toBe(50);
});

test("getLastFetchedAt returns recent fetched_at per panel or globally", () => {
  initDb();
  expect(getLastFetchedAt("nope")).toBeNull();
  expect(getLastFetchedAt()).toBeNull();

  saveItems("pf", [makeItem({ id: "f1", url: "https://f", timestamp: new Date() })]);
  const lastP = getLastFetchedAt("pf");
  expect(lastP).not.toBeNull();
  expect(typeof lastP).toBe("string");

  const lastAll = getLastFetchedAt();
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

test("dedup breaks timestamp ties with latest fetched_at then lowest id", () => {
  initDb();
  const tieTime = new Date("2025-06-01T12:00:00.000Z");
  const olderFetch = makeItem({
    id: "tie-z",
    url: "https://ex.com/tie",
    timestamp: tieTime,
    title: "older fetch",
  });
  const newerFetch = makeItem({
    id: "tie-a",
    url: "https://ex.com/tie/",
    timestamp: tieTime,
    title: "newer fetch",
  });
  saveItems("ptie", [olderFetch, newerFetch]);

  const db = getDb();
  db.prepare(
    "UPDATE content_items SET fetched_at = datetime('now', '-2 hours') WHERE id = ?",
  ).run("tie-z");
  db.prepare(
    "UPDATE content_items SET fetched_at = datetime('now', '-1 hour') WHERE id = ?",
  ).run("tie-a");

  const panel = getItemsByPanel("ptie", 10);
  expect(panel.length).toBe(1);
  expect(panel[0].id).toBe("tie-a");

  const sameFetchOlderId = makeItem({
    id: "tie-0",
    url: "https://ex.com/tie2",
    timestamp: tieTime,
  });
  const sameFetchNewerId = makeItem({
    id: "tie-1",
    url: "https://ex.com/tie2/",
    timestamp: tieTime,
  });
  saveItems("ptie2", [sameFetchOlderId, sameFetchNewerId]);
  const stamp = new Date().toISOString();
  db.prepare("UPDATE content_items SET fetched_at = ? WHERE panel_id = ?").run(stamp, "ptie2");

  const panel2 = getItemsByPanel("ptie2", 10);
  expect(panel2.length).toBe(1);
  expect(panel2[0].id).toBe("tie-0");
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

test("replacePanelItems per-item failure uses errorMessage in thrown message", () => {
  initDb();
  const database = getDb();
  const emSpy = spyOn(utilsMod, "errorMessage");
  const row = makeRow({
    id: "r1",
    panel_id: "prep",
    title: "t",
    url: "https://ex.com/r1",
    source: "s",
    body: null,
    summary: null,
  });
  const realPrepare = database.prepare.bind(database);
  const prepareSpy = spyOn(database, "prepare").mockImplementation((sql: unknown) => {
    const stmt = realPrepare(sql as string);
    if (typeof sql === "string" && sql.includes("INSERT INTO content_items")) {
      spyOn(stmt, "run").mockImplementation(() => {
        throw new Error("replace insert fail");
      });
    }
    return stmt;
  });
  try {
    expect(() => replacePanelItems("prep", [row])).toThrow(
      /db: failed to replace item id=r1 for panel=prep: replace insert fail/,
    );
    expect(emSpy).toHaveBeenCalled();
  } finally {
    prepareSpy.mockRestore();
    emSpy.mockRestore();
  }
});

test("getDb open failure uses errorMessage in thrown message", () => {
  closeDb();
  const emSpy = spyOn(utilsMod, "errorMessage");
  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(() => {
    throw new Error("mkdir fail");
  });
  try {
    expect(() => getDb()).toThrow(/db: failed to open.*mkdir fail/);
    expect(emSpy).toHaveBeenCalled();
  } finally {
    mkdirSpy.mockRestore();
    emSpy.mockRestore();
  }
});

test("saveItems transaction failure wraps non-db errors with panel context", () => {
  initDb();
  const database = getDb();
  const emSpy = spyOn(utilsMod, "errorMessage");
  const realTransaction = database.transaction.bind(database);
  const txSpy = spyOn(database, "transaction").mockImplementation((fn: () => void) => {
    return realTransaction(() => {
      throw new Error("tx abort");
    });
  });
  try {
    expect(() => saveItems("txerr", [makeItem({ id: "t1" })])).toThrow(
      /db: failed to save 1 items for panel txerr: tx abort/,
    );
    expect(emSpy).toHaveBeenCalled();
  } finally {
    txSpy.mockRestore();
    emSpy.mockRestore();
  }
});

test("getDb path switch warns when closing previous db fails", () => {
  initDb();
  const database = getDb();
  const warnSpy = spyOn(console, "warn");
  const closeSpy = spyOn(database, "close").mockImplementation(() => {
    throw new Error("switch close fail");
  });
  const otherDir = fs.mkdtempSync(join(tmpdir(), "pace-dbtest-switch-"));
  const otherPath = join(otherDir, "other.db");
  try {
    process.env.PACE_DB_PATH = otherPath;
    getDb();
    expect(warnSpy).toHaveBeenCalledWith("db: failed to close: switch close fail");
  } finally {
    closeSpy.mockRestore();
    warnSpy.mockRestore();
    closeDb();
    process.env.PACE_DB_PATH = tempDbFixture().dbPath;
    try {
      fs.rmSync(otherDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`db.test: failed to remove switch temp dir: ${utilsMod.errorMessage(err)}`);
    }
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

test("contentRowToItem maps persisted row fields to ContentItem", () => {
  const row = makeRow({
    id: "r1",
    panel_id: "panel-a",
    title: "Title",
    url: "https://ex.com/r1",
    source: "src",
    body: "body text",
    timestamp: "2024-06-01T12:00:00.000Z",
    fetched_at: "2024-06-02T08:00:00.000Z",
    summary: "summary text",
  });
  const item = contentRowToItem(row);
  expect(item).toEqual({
    id: "r1",
    title: "Title",
    url: "https://ex.com/r1",
    source: "src",
    timestamp: new Date("2024-06-01T12:00:00.000Z"),
    body: "body text",
  });
});

test("contentRowToItem converts null body to undefined", () => {
  const row = makeRow({
    id: "r2",
    panel_id: "panel-a",
    title: "No body",
    url: "https://ex.com/r2",
    source: "src",
    body: null,
    timestamp: "2024-06-01T12:00:00.000Z",
    fetched_at: "2024-06-02T08:00:00.000Z",
    summary: null,
  });
  expect(contentRowToItem(row).body).toBeUndefined();
});

test("coreContentItemFields normalizes Date timestamps and null body from items or rows", () => {
  const fromItem = coreContentItemFields(
    makeItem({
      id: "c1",
      title: "T",
      url: "https://ex.com",
      source: "src",
      body: undefined,
      timestamp: new Date("2024-06-01T12:00:00.000Z"),
    }),
  );
  expect(fromItem).toEqual({
    id: "c1",
    title: "T",
    url: "https://ex.com",
    source: "src",
    body: null,
    timestamp: "2024-06-01T12:00:00.000Z",
  });

  const fromRow = coreContentItemFields(
    makeRow({
      id: "c2",
      body: "kept",
      timestamp: "2024-07-01T00:00:00.000Z",
    }),
  );
  expect(fromRow.timestamp).toBe("2024-07-01T00:00:00.000Z");
  expect(fromRow.body).toBe("kept");
});

test("contentItemToRow preserves base row metadata and defaults merged panel", () => {
  const base = makeRow({
    id: "b1",
    panel_id: "panel-x",
    title: "Old",
    url: "https://ex.com/old",
    source: "old-src",
    body: "old body",
    timestamp: "2024-01-01T00:00:00.000Z",
    fetched_at: "2024-01-02T00:00:00.000Z",
    summary: "kept summary",
  });
  const item = makeItem({
    id: "b1",
    title: "New",
    url: "https://ex.com/new",
    source: "new-src",
    body: "new body",
    timestamp: new Date("2024-03-01T00:00:00.000Z"),
  });
  const row = contentItemToRow(item, base);
  expect(row.panel_id).toBe("panel-x");
  expect(row.fetched_at).toBe("2024-01-02T00:00:00.000Z");
  expect(row.summary).toBe("kept summary");
  expect(row.timestamp).toBe("2024-03-01T00:00:00.000Z");
  expect(row.body).toBe("new body");
});

test("contentItemToRow without base uses merged defaults", () => {
  const item = makeItem({
    id: "m1",
    title: "Merged",
    body: undefined,
    timestamp: new Date("2024-05-01T00:00:00.000Z"),
  });
  const row = contentItemToRow(item);
  expect(row.panel_id).toBe("merged");
  expect(row.summary).toBeNull();
  expect(row.body).toBeNull();
  expect(row.timestamp).toBe("2024-05-01T00:00:00.000Z");
});

test("contentRowsToItems and contentRowMapById round-trip row collections", () => {
  const rows: ContentItemRow[] = [
    makeRow({
      id: "a",
      panel_id: "p1",
      title: "A",
      url: "https://ex.com/a",
      source: "src",
      body: null,
      timestamp: "2024-06-01T12:00:00.000Z",
      fetched_at: "2024-06-02T08:00:00.000Z",
      summary: null,
    }),
    makeRow({
      id: "b",
      panel_id: "p1",
      title: "B",
      url: "https://ex.com/b",
      source: "src",
      body: "body",
      timestamp: "2024-06-01T13:00:00.000Z",
      fetched_at: "2024-06-02T08:00:00.000Z",
      summary: "sum",
    }),
  ];
  const items = contentRowsToItems(rows);
  expect(items.map((item) => item.id)).toEqual(["a", "b"]);
  expect(contentRowMapById(rows).get("b")?.title).toBe("B");
});

test("filterRowsByItemIds keeps rows matching item ids", () => {
  const rows: ContentItemRow[] = [
    makeRow({
      id: "keep",
      panel_id: "p1",
      title: "Keep",
      url: "https://ex.com/keep",
      source: "src",
      body: null,
      timestamp: "2024-06-01T12:00:00.000Z",
      fetched_at: "2024-06-02T08:00:00.000Z",
      summary: null,
    }),
    makeRow({
      id: "drop",
      panel_id: "p1",
      title: "Drop",
      url: "https://ex.com/drop",
      source: "src",
      body: null,
      timestamp: "2024-06-01T12:00:00.000Z",
      fetched_at: "2024-06-02T08:00:00.000Z",
      summary: null,
    }),
  ];
  const kept = filterRowsByItemIds(rows, [{ id: "keep" }]);
  expect(kept.map((row) => row.id)).toEqual(["keep"]);
});

test("contentItemsToRows inherits base row metadata and split id fallback", () => {
  const base = makeRow({
    id: "x",
    panel_id: "panel-z",
    title: "Base",
    url: "https://ex.com/x",
    source: "src",
    body: null,
    timestamp: "2024-06-01T12:00:00.000Z",
    fetched_at: "2024-06-02T08:00:00.000Z",
    summary: "base summary",
  });
  const rowById = contentRowMapById([base]);
  const merged = contentItemsToRows(
    [makeItem({ id: "x+y", title: "Merged", timestamp: new Date("2024-07-01T00:00:00.000Z") })],
    rowById,
  );
  expect(merged[0].panel_id).toBe("panel-z");
  expect(merged[0].summary).toBe("base summary");
  expect(merged[0].title).toBe("Merged");
});
