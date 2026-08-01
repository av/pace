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
  toDbFetchedAt,
  type ContentItemRow,
} from "./db";
import * as utilsMod from "./utils";
import {
  expectThrowUsesErrorMessage,
  withErrorMessageSpy,
} from "./test/error-message-spy";
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

test("toDbFetchedAt normalizes Dates and ISO strings to SQLite UTC format", () => {
  expect(toDbFetchedAt(new Date("2024-01-02T03:04:05.678Z"))).toBe("2024-01-02 03:04:05");
  expect(toDbFetchedAt("2024-01-02T03:04:05.678Z")).toBe("2024-01-02 03:04:05");
  expect(toDbFetchedAt("2024-01-02T03:04:05+02:00")).toBe("2024-01-02 01:04:05");
  // Already-canonical and non-ISO strings pass through untouched
  // (new Date() would misparse space-separated strings as local time).
  expect(toDbFetchedAt("2024-01-02 03:04:05")).toBe("2024-01-02 03:04:05");
  expect(toDbFetchedAt("2024-01-02 03:04:05.123")).toBe("2024-01-02 03:04:05.123");
  expect(toDbFetchedAt("not a date T")).toBe("not a date T");
});

test("ISO fetched_at rows are normalized so string comparisons against datetime('now') rows stay correct", () => {
  initDb();
  const db = getDb();
  const tieTime = "2025-06-01T12:00:00.000Z";

  // Adapter-style row (datetime('now') format), fetched at 10:00.
  saveItems("pmixa", [
    makeItem({ id: "mix-raw", url: "https://ex.com/mix", timestamp: new Date(tieTime), title: "raw" }),
  ]);
  db.prepare("UPDATE content_items SET fetched_at = '2026-01-05 10:00:00' WHERE id = 'mix-raw'").run();

  // JS-built row (e.g. llm-merge output) with ISO fetched_at, actually OLDER (08:00 same day).
  replacePanelItems("pmixb", [
    makeRow({
      id: "mix-iso",
      url: "https://ex.com/mix",
      timestamp: tieTime,
      fetched_at: "2026-01-05T08:00:00.000Z",
      title: "iso",
    }),
  ]);

  // MAX(fetched_at) must pick the genuinely newer 10:00 row. Before
  // normalization the ISO string won lexically ('T' > ' ').
  expect(getLastFetchedAt()).toBe("2026-01-05 10:00:00Z");

  // Dedup tie-break (same url, same timestamp) orders by fetched_at DESC:
  // the newer-fetched raw row must win, not the ISO-formatted older one.
  const recent = getRecentItems(10);
  expect(recent.map((r) => r.id)).toEqual(["mix-raw"]);
});

test("pruneOldItems prunes ISO-format rows aged past the cutoff on the cutoff day", () => {
  initDb();
  // Fetched 30 days + 1 hour ago, written as ISO via replacePanelItems.
  // Pre-normalization this survived same-day cutoffs ('T' > ' ' pushed it
  // lexically past datetime('now', '-30 days')).
  const aged = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);
  replacePanelItems("pprISO", [
    makeRow({ id: "iso-old", url: "https://ex.com/iso-old", fetched_at: aged.toISOString() }),
  ]);
  expect(pruneOldItems(30)).toBe(1);
  expect(getAllItemsByPanel("pprISO").length).toBe(0);
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

test("dedup prefers the pipeline (enriched) copy over the raw item on full ties", () => {
  initDb();
  const tieTime = new Date("2025-06-01T12:00:00.000Z");
  // Raw adapter item and its pipeline copy on a shared panel: same url,
  // timestamp, and (after replacePanelItems) same fetched_at. Lexicographic
  // id ASC alone would pick the raw item ("h1" < "pipeline:..."); the
  // enriched copy must win instead.
  saveItems("pshared", [
    makeItem({ id: "h1", url: "https://ex.com/story", timestamp: tieTime, title: "raw" }),
    makeItem({ id: "pipeline:curated:h1", url: "https://ex.com/story", timestamp: tieTime, title: "enriched" }),
  ]);
  const stamp = new Date().toISOString();
  getDb().prepare("UPDATE content_items SET fetched_at = ? WHERE panel_id = ?").run(stamp, "pshared");

  const panel = getItemsByPanel("pshared", 10);
  expect(panel.length).toBe(1);
  expect(panel[0].id).toBe("pipeline:curated:h1");

  // A strictly newer raw item still beats an older pipeline copy: the
  // pipeline preference only breaks exact timestamp/fetched_at ties.
  saveItems("pshared2", [
    makeItem({ id: "pipeline:curated:h2", url: "https://ex.com/story2", timestamp: tieTime, title: "old enriched" }),
    makeItem({ id: "h2", url: "https://ex.com/story2", timestamp: new Date("2025-06-02T12:00:00.000Z"), title: "new raw" }),
  ]);
  getDb().prepare("UPDATE content_items SET fetched_at = ? WHERE panel_id = ?").run(stamp, "pshared2");
  const panel2 = getItemsByPanel("pshared2", 10);
  expect(panel2.length).toBe(1);
  expect(panel2[0].id).toBe("h2");
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

test("saveItems upsert is scoped per panel: cross-panel save inserts a copy instead of moving", () => {
  initDb();
  const first = makeItem({ id: "upsert1", url: "https://ex.com/upsert/a", timestamp: new Date("2020-01-01"), title: "first" });
  saveItems("panelA", [first]);
  const second = makeItem({ id: "upsert1", url: "https://ex.com/upsert/b", timestamp: new Date("2020-01-02"), title: "second" });
  saveItems("panelB", [second]);
  const dbh = getDb();
  const rows = dbh
    .prepare("SELECT id, panel_id, title, url, fetched_at FROM content_items WHERE id = ? ORDER BY panel_id")
    .all("upsert1") as ContentItemUpsertRow[];
  expect(rows.length).toBe(2);
  expect(rows[0]).toMatchObject({ panel_id: "panelA", title: "first", url: "https://ex.com/upsert/a" });
  expect(rows[1]).toMatchObject({ panel_id: "panelB", title: "second", url: "https://ex.com/upsert/b" });

  // Same-panel re-save still updates in place (the common single-panel case).
  const third = makeItem({ id: "upsert1", url: "https://ex.com/upsert/c", timestamp: new Date("2020-01-03"), title: "third" });
  saveItems("panelA", [third]);
  const updated = dbh
    .prepare("SELECT title, url, fetched_at FROM content_items WHERE id = ? AND panel_id = ?")
    .get("upsert1", "panelA") as ContentItemUpsertRow;
  expect(updated.title).toBe("third");
  expect(updated.url).toBe("https://ex.com/upsert/c");
  expect(updated.fetched_at).toBeTruthy();
});

test("saveItems stamps ownerSource; an ownerless re-save never clears it; replacePanelItems round-trips it", () => {
  initDb();
  const item = makeItem({ id: "own1", url: "https://ex.com/own/1", timestamp: new Date("2020-01-01") });
  saveItems("p1", [item], { ownerSource: "hn" });
  const readOwner = () =>
    (getDb().prepare("SELECT owner_source FROM content_items WHERE id = ? AND panel_id = ?")
      .get("own1", "p1") as { owner_source: string | null }).owner_source;
  expect(readOwner()).toBe("hn");

  // A save without ownerSource (e.g. a legacy/manual path) must not clear the
  // attribution the owning source stamped.
  saveItems("p1", [item]);
  expect(readOwner()).toBe("hn");

  // Panel rewrites (transform replaces) carry the owner through.
  const rows = getAllItemsByPanel("p1");
  expect(rows[0].owner_source).toBe("hn");
  replacePanelItems("p1", rows);
  expect(readOwner()).toBe("hn");
});

test("initDb failure uses errorMessage in thrown message", async () => {
  initDb();
  const database = getDb();
  const execSpy = spyOn(database, "exec").mockImplementation(() => {
    throw new Error("schema exec fail");
  });
  try {
    await expectThrowUsesErrorMessage(
      () => initDb(),
      /db: failed to init.*schema exec fail/,
    );
  } finally {
    execSpy.mockRestore();
  }
});

test("saveItems per-item failure uses errorMessage in thrown message", async () => {
  initDb();
  const database = getDb();
  const realPrepare = database.prepare.bind(database);
  const prepareSpy = spyOn(database, "prepare").mockImplementation(((sql: string) => {
    const stmt = realPrepare(sql);
    if (sql.includes("INSERT INTO content_items")) {
      spyOn(stmt, "run").mockImplementation(() => {
        throw new Error("insert fail");
      });
    }
    return stmt;
  }) as typeof database.prepare);
  try {
    await expectThrowUsesErrorMessage(
      () => saveItems("perr", [makeItem({ id: "bad1" })]),
      /db: failed to save item id=bad1 for panel=perr: insert fail/,
    );
  } finally {
    prepareSpy.mockRestore();
  }
});

test("replacePanelItems per-item failure uses errorMessage in thrown message", async () => {
  initDb();
  const database = getDb();
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
  const prepareSpy = spyOn(database, "prepare").mockImplementation(((sql: string) => {
    const stmt = realPrepare(sql);
    if (sql.includes("INSERT OR REPLACE INTO content_items")) {
      spyOn(stmt, "run").mockImplementation(() => {
        throw new Error("replace insert fail");
      });
    }
    return stmt;
  }) as typeof database.prepare);
  try {
    await expectThrowUsesErrorMessage(
      () => replacePanelItems("prep", [row]),
      /db: failed to replace item id=r1 for panel=prep: replace insert fail/,
    );
  } finally {
    prepareSpy.mockRestore();
  }
});

test("getDb open failure uses errorMessage in thrown message", async () => {
  closeDb();
  const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(() => {
    throw new Error("mkdir fail");
  });
  try {
    await expectThrowUsesErrorMessage(() => getDb(), /db: failed to open.*mkdir fail/);
  } finally {
    mkdirSpy.mockRestore();
  }
});

test("saveItems transaction failure wraps non-db errors with panel context", async () => {
  initDb();
  const database = getDb();
  const realTransaction = database.transaction.bind(database);
  const txSpy = spyOn(database, "transaction").mockImplementation((fn: () => void) => {
    return realTransaction(() => {
      throw new Error("tx abort");
    });
  });
  try {
    await expectThrowUsesErrorMessage(
      () => saveItems("txerr", [makeItem({ id: "t1" })]),
      /db: failed to save 1 items for panel txerr: tx abort/,
    );
  } finally {
    txSpy.mockRestore();
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

test("closeDb warns with errorMessage when db.close throws", async () => {
  initDb();
  const database = getDb();
  const warnSpy = spyOn(console, "warn");
  const closeSpy = spyOn(database, "close").mockImplementation(() => {
    throw new Error("close fail");
  });
  try {
    await withErrorMessageSpy((emSpy) => {
      closeDb();
      expect(warnSpy).toHaveBeenCalledWith("db: failed to close: close fail");
      expect(emSpy).toHaveBeenCalled();
    });
  } finally {
    closeSpy.mockRestore();
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
  // ISO base fetched_at is normalized to the canonical SQLite UTC format.
  expect(row.fetched_at).toBe("2024-01-02 00:00:00");
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

// --- Bookmarks DB write/read ---

test("bookmarks items with stable IDs can be written and read back", () => {
  initDb();
  const b1 = makeItem({
    id: "bookmarks:my-tool-0",
    title: "My Tool",
    url: "https://example.com/tool",
    source: "bookmarks",
    body: "A useful dev tool",
    timestamp: new Date("2025-01-01"),
  });
  const b2 = makeItem({
    id: "bookmarks:another-tool-1",
    title: "Another Tool",
    url: "https://example.com/other",
    source: "bookmarks:devtools",
    body: undefined,
    timestamp: new Date("2025-01-02"),
  });
  saveItems("bk-panel", [b1, b2]);

  const rows = getItemsByPanel("bk-panel", 10);
  expect(rows.length).toBe(2);
  const ids = rows.map((r) => r.id).sort();
  expect(ids).toEqual(["bookmarks:another-tool-1", "bookmarks:my-tool-0"]);

  const toolRow = rows.find((r) => r.id === "bookmarks:my-tool-0");
  expect(toolRow?.title).toBe("My Tool");
  expect(toolRow?.source).toBe("bookmarks");
  expect(toolRow?.body).toBe("A useful dev tool");

  const otherRow = rows.find((r) => r.id === "bookmarks:another-tool-1");
  expect(otherRow?.source).toBe("bookmarks:devtools");
  expect(otherRow?.body).toBeNull();
});

test("bookmarks ON CONFLICT(id) upserts on re-fetch with same stable IDs", () => {
  initDb();
  const first = makeItem({
    id: "bookmarks:github-0",
    title: "GitHub",
    url: "https://github.com",
    source: "bookmarks",
    body: "Code hosting",
    timestamp: new Date("2025-01-01"),
  });
  saveItems("bk", [first]);

  // simulate re-fetch with updated description
  const updated = makeItem({
    id: "bookmarks:github-0",
    title: "GitHub",
    url: "https://github.com",
    source: "bookmarks",
    body: "Code hosting platform with CI/CD",
    timestamp: new Date("2025-01-01"),
  });
  saveItems("bk", [updated]);

  const db = getDb();
  const allRows = db.prepare("SELECT * FROM content_items WHERE id = ?").all("bookmarks:github-0") as ContentItemRow[];
  // only one row, not duplicated
  expect(allRows.length).toBe(1);
  expect(allRows[0].body).toBe("Code hosting platform with CI/CD");
});

test("bookmarks items are deduplicated properly when URLs differ (different items)", () => {
  initDb();
  const items = [
    makeItem({ id: "bookmarks:a-0", url: "https://a.com", source: "bookmarks", timestamp: new Date("2025-01-01") }),
    makeItem({ id: "bookmarks:b-1", url: "https://b.com", source: "bookmarks", timestamp: new Date("2025-01-02") }),
    makeItem({ id: "bookmarks:c-2", url: "https://c.com", source: "bookmarks:tag", timestamp: new Date("2025-01-03") }),
  ];
  saveItems("bk-dedup", items);

  const rows = getItemsByPanel("bk-dedup", 10);
  expect(rows.length).toBe(3);
});

test("prune job handles bookmarks items correctly", () => {
  initDb();
  const bookmark = makeItem({
    id: "bookmarks:old-link-0",
    url: "https://old.example.com",
    source: "bookmarks",
    timestamp: new Date("2000-01-01"),
  });
  saveItems("bk-prune", [bookmark]);

  const db = getDb();
  // backdate fetched_at so prune picks it up
  db.prepare("UPDATE content_items SET fetched_at = datetime('now', '-60 days') WHERE id = ?").run("bookmarks:old-link-0");

  const pruned = pruneOldItems(30);
  expect(pruned).toBe(1);
  expect(getItemsByPanel("bk-prune", 10).length).toBe(0);
});

test("bookmarks item with very long body (10000+ chars) survives write/read", () => {
  initDb();
  const longBody = "x".repeat(12000);
  const item = makeItem({
    id: "bookmarks:longbody-0",
    url: "https://long.example.com",
    source: "bookmarks",
    body: longBody,
    timestamp: new Date("2025-01-01"),
  });
  saveItems("bk-long", [item]);

  const rows = getItemsByPanel("bk-long", 10);
  expect(rows.length).toBe(1);
  expect(rows[0].body).toBe(longBody);
  expect(rows[0].body!.length).toBe(12000);
});

test("bookmarks source label with special characters survives write/read", () => {
  initDb();
  const item = makeItem({
    id: "bookmarks:special-0",
    url: "https://special.example.com",
    source: "bookmarks:dev/ops & infra",
    timestamp: new Date("2025-01-01"),
  });
  saveItems("bk-special", [item]);

  const rows = getItemsByPanel("bk-special", 10);
  expect(rows.length).toBe(1);
  expect(rows[0].source).toBe("bookmarks:dev/ops & infra");
});

// --- Counter DB write/read ---

test("counter items can be written and read back with JSON body", () => {
  initDb();
  const counter = makeItem({
    id: "counter:stars:1700000000000",
    title: "GitHub Stars",
    url: "https://api.github.com/repos/example/repo",
    source: "counter",
    body: JSON.stringify({ value: 42, unit: "k", previous: 38 }),
    timestamp: new Date("2025-01-01"),
  });
  saveItems("cnt-panel", [counter]);

  const rows = getItemsByPanel("cnt-panel", 10);
  expect(rows.length).toBe(1);
  expect(rows[0].id).toBe("counter:stars:1700000000000");
  expect(rows[0].body).toBe('{"value":42,"unit":"k","previous":38}');

  // verify JSON round-trip
  const parsed = JSON.parse(rows[0].body!);
  expect(parsed.value).toBe(42);
  expect(parsed.unit).toBe("k");
  expect(parsed.previous).toBe(38);
});

test("counter items with changing IDs accumulate but dedup collapses them by URL", () => {
  initDb();
  // simulate multiple fetches: same URL, different timestamp-based IDs
  const fetch1 = makeItem({
    id: "counter:stars:1700000000000",
    title: "Stars",
    url: "https://api.github.com/repos/ex/repo",
    source: "counter",
    body: JSON.stringify({ value: 100 }),
    timestamp: new Date("2025-01-01T10:00:00Z"),
  });
  const fetch2 = makeItem({
    id: "counter:stars:1700000001000",
    title: "Stars",
    url: "https://api.github.com/repos/ex/repo",
    source: "counter",
    body: JSON.stringify({ value: 105 }),
    timestamp: new Date("2025-01-01T11:00:00Z"),
  });
  saveItems("cnt-dedup", [fetch1]);
  saveItems("cnt-dedup", [fetch2]);

  // raw: both rows exist in DB
  const db = getDb();
  const rawCount = db.prepare("SELECT COUNT(*) as n FROM content_items WHERE panel_id = ?").get("cnt-dedup") as { n: number };
  expect(rawCount.n).toBe(2);

  // deduped: only the latest one (same URL normalizes to same group)
  const deduped = getItemsByPanel("cnt-dedup", 10);
  expect(deduped.length).toBe(1);
  expect(deduped[0].id).toBe("counter:stars:1700000001000");
  expect(JSON.parse(deduped[0].body!).value).toBe(105);
});

test("old counter items are pruned correctly", () => {
  initDb();
  const oldCounter = makeItem({
    id: "counter:metric:1600000000000",
    url: "https://api.example.com/metric",
    source: "counter",
    body: JSON.stringify({ value: 50 }),
    timestamp: new Date("2020-01-01"),
  });
  const freshCounter = makeItem({
    id: "counter:metric:1700000000000",
    url: "https://api.example.com/metric",
    source: "counter",
    body: JSON.stringify({ value: 60 }),
    timestamp: new Date(),
  });
  saveItems("cnt-prune", [oldCounter, freshCounter]);

  const db = getDb();
  db.prepare("UPDATE content_items SET fetched_at = datetime('now', '-45 days') WHERE id = ?").run("counter:metric:1600000000000");

  const pruned = pruneOldItems(30);
  expect(pruned).toBe(1);

  const remaining = getItemsByPanel("cnt-prune", 10);
  expect(remaining.length).toBe(1);
  expect(remaining[0].id).toBe("counter:metric:1700000000000");
});

test("counter body with unicode survives write/read", () => {
  initDb();
  const item = makeItem({
    id: "counter:uni:1700000000000",
    url: "https://api.example.com/data",
    source: "counter",
    body: JSON.stringify({ value: 42, unit: "°C", previous: 38 }),
    timestamp: new Date("2025-01-01"),
  });
  saveItems("cnt-unicode", [item]);

  const rows = getItemsByPanel("cnt-unicode", 10);
  expect(rows.length).toBe(1);
  const parsed = JSON.parse(rows[0].body!);
  expect(parsed.unit).toBe("°C");
  expect(parsed.value).toBe(42);
});

test("counter body with very large JSON survives write/read", () => {
  initDb();
  const largeObj = {
    value: 999999,
    unit: "%",
    previous: 0,
    metadata: { description: "a".repeat(5000) },
  };
  const item = makeItem({
    id: "counter:large:1700000000000",
    url: "https://api.example.com/big",
    source: "counter",
    body: JSON.stringify(largeObj),
    timestamp: new Date("2025-01-01"),
  });
  saveItems("cnt-large", [item]);

  const rows = getItemsByPanel("cnt-large", 10);
  expect(rows.length).toBe(1);
  const parsed = JSON.parse(rows[0].body!);
  expect(parsed.value).toBe(999999);
  expect(parsed.metadata.description.length).toBe(5000);
});

// --- Counter dedup with empty URL edge case ---

test("counter items with empty URL fall back to id-based dedup (no collapse)", () => {
  initDb();
  // if counter somehow produces empty URLs, each item should stay separate
  const c1 = makeItem({
    id: "counter:a:1700000000000",
    url: "",
    source: "counter",
    body: JSON.stringify({ value: 1 }),
    timestamp: new Date("2025-01-01"),
  });
  const c2 = makeItem({
    id: "counter:a:1700000001000",
    url: "",
    source: "counter",
    body: JSON.stringify({ value: 2 }),
    timestamp: new Date("2025-01-02"),
  });
  saveItems("cnt-nourl", [c1, c2]);

  // with empty URL, dedup groups by id (CASE expression), so both survive
  const rows = getItemsByPanel("cnt-nourl", 10);
  expect(rows.length).toBe(2);
});

// --- Final close (shutdown) semantics ---

test("getDb after closeDb({ final: true }) throws instead of silently re-opening", () => {
  initDb();
  closeDb({ final: true });
  // A straggler writer that outlived the shutdown drain must fail loudly.
  expect(() => getDb()).toThrow(/closed for shutdown/);
  // A later plain closeDb lifts the seal (test-harness close/re-open pattern).
  closeDb();
  expect(() => getDb()).not.toThrow();
});

test("plain closeDb still allows re-open (no seal)", () => {
  initDb();
  closeDb();
  expect(() => getDb()).not.toThrow();
});

// --- Invalid Date backstop (defense in depth against raw new Date(garbage)) ---

test("saveItems degrades an Invalid Date item to now instead of rolling back the panel save", () => {
  initDb();
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const before = Date.now();
    const good = makeItem({
      id: "ts-good",
      url: "https://ex.com/ts-good",
      timestamp: new Date("2024-06-01T12:00:00.000Z"),
    });
    const bad = makeItem({
      id: "ts-bad",
      url: "https://ex.com/ts-bad",
      timestamp: new Date("garbage"),
    });

    expect(() => saveItems("inv-ts", [good, bad])).not.toThrow();

    const rows = getItemsByPanel("inv-ts", 10);
    expect(rows.length).toBe(2);
    const badRow = rows.find((r) => r.id === "ts-bad")!;
    const stored = new Date(badRow.timestamp).getTime();
    expect(stored).toBeGreaterThanOrEqual(before - 1000);
    expect(stored).toBeLessThanOrEqual(Date.now() + 1000);
    expect(warnSpy).toHaveBeenCalledWith(
      "db: invalid Date timestamp on item id=ts-bad; falling back to now",
    );
  } finally {
    warnSpy.mockRestore();
  }
});

test("coreContentItemFields converts an Invalid Date to a valid ISO timestamp with a warning", () => {
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const fields = coreContentItemFields(
      makeItem({ id: "inv-core", timestamp: new Date(Number.NaN) }),
    );
    expect(Number.isNaN(new Date(fields.timestamp).getTime())).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      "db: invalid Date timestamp on item id=inv-core; falling back to now",
    );
  } finally {
    warnSpy.mockRestore();
  }
});
