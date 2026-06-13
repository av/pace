import { test, expect } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import { initDb, saveItems, getAllItemsByPanel, getDb, type ContentItemRow } from "./db";
import { makeContentItem, makeContentItemRow } from "./test/content-items";
import { dedupeGroupedByKey, dedupeByTitleSimilarity, mergeOrigins } from "./dedupe";
import { runPipeline } from "./transforms";
import type { TransformContext } from "./transforms";

installTempDbHooks({ prefix: "pace-provenance-", init: false, warnOnRmFail: true });

const ctx: TransformContext = { llmModel: null, llmConfig: undefined };

// ── 1. Migration: columns exist after initDb ────────────────────────────────

test("initDb migration adds origins and applied_transforms columns", () => {
  initDb();
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(content_items)").all() as { name: string }[];
  const names = cols.map((c) => c.name);
  expect(names).toContain("origins");
  expect(names).toContain("applied_transforms");
});

test("migration is idempotent — initDb twice does not throw", () => {
  initDb();
  expect(() => initDb()).not.toThrow();
});

// ── 2. Ingest: origins stamped from item.source ─────────────────────────────

test("saveItems stamps origins=[item.source] on each item", () => {
  initDb();
  const item = makeContentItem({ id: "orig1", source: "hackernews", url: "https://hn.com/1" });
  saveItems("panel-hn", [item]);

  const db = getDb();
  const row = db.prepare("SELECT origins FROM content_items WHERE id = ?").get("orig1") as { origins: string | null };
  expect(row).not.toBeNull();
  expect(row.origins).not.toBeNull();
  const origins = JSON.parse(row.origins!);
  expect(origins).toEqual(["hackernews"]);
});

test("saveItems stamps origins for multiple items with different sources", () => {
  initDb();
  const a = makeContentItem({ id: "src-a", source: "reddit" });
  const b = makeContentItem({ id: "src-b", source: "lobsters" });
  saveItems("panel-multi", [a, b]);

  const db = getDb();
  const ra = db.prepare("SELECT origins FROM content_items WHERE id = ?").get("src-a") as { origins: string };
  const rb = db.prepare("SELECT origins FROM content_items WHERE id = ?").get("src-b") as { origins: string };
  expect(JSON.parse(ra.origins)).toEqual(["reddit"]);
  expect(JSON.parse(rb.origins)).toEqual(["lobsters"]);
});

// ── 3. Dedupe: mergeOrigins unions origins ──────────────────────────────────

test("mergeOrigins unions origins from all group members onto winner", () => {
  const winner = makeContentItemRow({ id: "w1", origins: JSON.stringify(["hn"]) });
  const loser = makeContentItemRow({ id: "l1", origins: JSON.stringify(["reddit"]) });
  const merged = mergeOrigins([winner, loser], winner);
  const origins = JSON.parse(merged.origins!);
  expect(origins.sort()).toEqual(["hn", "reddit"]);
});

test("mergeOrigins deduplicates overlapping origins", () => {
  const a = makeContentItemRow({ id: "a1", origins: JSON.stringify(["hn", "mastodon"]) });
  const b = makeContentItemRow({ id: "b1", origins: JSON.stringify(["hn"]) });
  const merged = mergeOrigins([a, b], a);
  const origins = JSON.parse(merged.origins!);
  expect(origins.sort()).toEqual(["hn", "mastodon"]);
});

test("mergeOrigins handles null origins gracefully", () => {
  const winner = makeContentItemRow({ id: "w2", origins: null });
  const loser = makeContentItemRow({ id: "l2", origins: null });
  const merged = mergeOrigins([winner, loser], winner);
  // no origins to union, winner unchanged
  expect(merged.origins).toBeNull();
});

test("dedupeGroupedByKey unions origins on deduplicated groups", () => {
  const a = makeContentItemRow({ id: "a", url: "https://ex.com/p", origins: JSON.stringify(["hn"]) });
  const b = makeContentItemRow({ id: "b", url: "https://ex.com/p", origins: JSON.stringify(["mastodon"]) });
  const { result } = dedupeGroupedByKey([a, b], (i) => i.url, "first", () => "");
  expect(result.length).toBe(1);
  const origins = JSON.parse(result[0].origins!);
  expect(origins.sort()).toEqual(["hn", "mastodon"]);
});

test("dedupeByTitleSimilarity unions origins when titles merge", () => {
  const a = makeContentItemRow({ id: "ta", title: "Hello World", origins: JSON.stringify(["hn"]) });
  const b = makeContentItemRow({ id: "tb", title: "Hello World!", origins: JSON.stringify(["reddit"]) });
  const { result } = dedupeByTitleSimilarity([a, b], 0.8, "latest", () => "");
  expect(result.length).toBe(1);
  const origins = JSON.parse(result[0].origins!);
  expect(origins.sort()).toEqual(["hn", "reddit"]);
});

// ── 4. runPipeline: applied_transforms accumulates through steps ────────────

test("runPipeline stamps applied_transforms with step type after each step", async () => {
  const items: ContentItemRow[] = [
    makeContentItemRow({ id: "p1", url: "https://ex.com/p1", timestamp: new Date().toISOString() }),
    makeContentItemRow({ id: "p2", url: "https://ex.com/p2", timestamp: new Date().toISOString() }),
  ];

  const result = await runPipeline(items, [{ type: "latest", count: 10 }], ctx);
  expect(result.length).toBe(2);
  for (const row of result) {
    expect(JSON.parse(row.applied_transforms!)).toEqual(["latest"]);
  }
});

test("runPipeline accumulates distinct transform types across 2 steps", async () => {
  const ts = (offset: number) => new Date(Date.now() + offset).toISOString();
  const items: ContentItemRow[] = [
    makeContentItemRow({ id: "q1", url: "https://ex.com/q1", timestamp: ts(2) }),
    makeContentItemRow({ id: "q2", url: "https://ex.com/q2", timestamp: ts(1) }),
    makeContentItemRow({ id: "q3", url: "https://ex.com/q3", timestamp: ts(0) }),
  ];

  const result = await runPipeline(
    items,
    [
      { type: "latest", count: 3 },
      { type: "sort", field: "timestamp", direction: "desc" },
    ],
    ctx,
  );

  expect(result.length).toBe(3);
  for (const row of result) {
    const at = JSON.parse(row.applied_transforms!);
    expect(at).toContain("latest");
    expect(at).toContain("sort");
    expect(at.length).toBe(2);
  }
});

test("runPipeline does not duplicate transform type if same step runs twice", async () => {
  const items: ContentItemRow[] = [
    makeContentItemRow({ id: "r1", url: "https://ex.com/r1", applied_transforms: JSON.stringify(["latest"]) }),
  ];

  const result = await runPipeline(items, [{ type: "latest", count: 10 }], ctx);
  expect(JSON.parse(result[0].applied_transforms!)).toEqual(["latest"]);
});
