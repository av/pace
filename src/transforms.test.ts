import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { runPipeline, type TransformContext, extractEngagementScore } from "./transforms";
import type { ContentItemRow } from "./db";

function makeRow(overrides: Partial<ContentItemRow> = {}): ContentItemRow {
  const base: ContentItemRow = {
    id: "id-" + Math.random().toString(36).slice(2),
    panel_id: "panel-1",
    title: "Default Title",
    url: "https://example.com/item",
    source: "test-source",
    body: "Default body content here.",
    timestamp: new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    summary: null,
  };
  return { ...base, ...overrides };
}

const ctx: TransformContext = { llmModel: null };

describe("transforms - filter and exclude (DRY quality)", () => {
  let items: ContentItemRow[];

  beforeEach(() => {
    items = [
      makeRow({ id: "1", title: "Alpha News: exciting update", body: "Details about alpha.", source: "alpha" }),
      makeRow({ id: "2", title: "Beta Report", body: "Beta has interesting features and news.", source: "beta" }),
      makeRow({ id: "3", title: "Gamma Overview", body: "No keywords here at all.", source: "gamma" }),
      makeRow({ id: "4", title: "Delta Post", body: "Mentions alpha and beta briefly.", source: "delta" }),
    ];
  });

  test("filter keeps only items matching any keyword in default fields (title, body)", async () => {
    const pipeline = [{ type: "filter", keywords: ["alpha", "beta"] } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map(r => r.id)).toEqual(["1", "2", "4"]);
  });

  test("filter with explicit fields limits matching to those fields", async () => {
    const pipeline = [{ type: "filter", keywords: ["alpha"], fields: ["source"] } as any];
    const result = await runPipeline(items, pipeline, ctx);
    // only item 1 has source containing? wait sources are alpha/beta etc, item1 source="alpha"
    expect(result.map(r => r.id)).toEqual(["1"]);
  });

  test("exclude removes items matching any keyword in default fields", async () => {
    const pipeline = [{ type: "exclude", keywords: ["alpha", "gamma"] } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map(r => r.id)).toEqual(["2"]); // 1 (alpha), 3 (gamma), 4 (alpha in body) removed; only 2 remains
  });

  test("exclude with fields option works", async () => {
    const pipeline = [{ type: "exclude", keywords: ["beta"], fields: ["source"] } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map(r => r.id)).toEqual(["1", "3", "4"]); // 2 excluded by source
  });

  test("combined filter then exclude pipeline produces correct intersection", async () => {
    const pipeline = [
      { type: "filter", keywords: ["alpha", "beta", "gamma"] } as any,
      { type: "exclude", keywords: ["gamma"] } as any,
    ];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map(r => r.id)).toEqual(["1", "2", "4"]); // gamma excluded after filter
  });

  test("filter with no matching keywords returns empty", async () => {
    const pipeline = [{ type: "filter", keywords: ["nonexistent"] } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result).toHaveLength(0);
  });

  test("exclude with no matching keywords returns all", async () => {
    const pipeline = [{ type: "exclude", keywords: ["nonexistent"] } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result).toHaveLength(4);
  });
});

describe("transforms - runPipeline basics", () => {
  test("empty pipeline returns items unchanged", async () => {
    const items = [makeRow({ title: "only" })];
    const result = await runPipeline(items, [], ctx);
    expect(result).toEqual(items);
  });

  test("unknown transform type is skipped with warning (no crash)", async () => {
    const items = [makeRow()];
    const pipeline = [{ type: "nonexistent" } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result).toHaveLength(1);
  });

  test("latest transform limits count", async () => {
    const items = [makeRow({id:"a"}), makeRow({id:"b"}), makeRow({id:"c"})];
    const pipeline = [{ type: "latest", count: 2 } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map(r => r.id)).toEqual(["a", "b"]);
  });
});

describe("transforms - dedupe strategies (logging DRY quality)", () => {
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "log");
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  test("dedupe:url removes exact dups and logs when enabled (default)", async () => {
    const items = [
      makeRow({ id: "1", title: "First", url: "https://ex.com/a" }),
      makeRow({ id: "2", title: "Dup", url: "https://ex.com/a" }),
      makeRow({ id: "3", title: "Third", url: "https://ex.com/b" }),
    ];
    const pipeline = [{ type: "dedupe", strategy: "url", log: true } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map((r) => r.id)).toEqual(["1", "3"]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[dedupe:url] removed 1 duplicate(s):"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  - "Dup" (https://ex.com/a)'));
  });

  test("dedupe:domain-normalized groups by normalized url and logs", async () => {
    const items = [
      makeRow({ id: "1", title: "A1", url: "https://www.Example.com/foo/", timestamp: "2024-01-01T00:00:00Z" }),
      makeRow({ id: "2", title: "A2", url: "https://example.com/foo?utm_source=xx", timestamp: "2024-01-02T00:00:00Z" }),
      makeRow({ id: "3", title: "B", url: "https://ex.com/other" }),
    ];
    const pipeline = [{ type: "dedupe", strategy: "domain-normalized", keep: "latest", log: true } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map((r) => r.id)).toEqual(["2", "3"]); // latest of the group kept
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[dedupe:domain-normalized] removed 1 duplicate(s):"));
  });

  test("dedupe:title-similarity detects near titles, keeps winner, logs with threshold", async () => {
    const items = [
      makeRow({ id: "1", title: "Hello World Update", url: "u1", timestamp: "2024-01-01T00:00:00Z" }),
      makeRow({ id: "2", title: "Hello World Upd8", url: "u2", timestamp: "2024-01-02T00:00:00Z" }),
      makeRow({ id: "3", title: "Other News", url: "u3" }),
    ];
    const pipeline = [{ type: "dedupe", strategy: "title-similarity", threshold: 0.8, keep: "latest", log: true } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map((r) => r.id)).toContain("2"); // or 1 depending on pick, but one kept + 3
    expect(result).toHaveLength(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[dedupe:title-similarity] removed 1 duplicate(s) (threshold=0.8):"));
  });

  test("dedupe log disabled does not emit console.log", async () => {
    const items = [makeRow({ url: "x" }), makeRow({ url: "x" })];
    const pipeline = [{ type: "dedupe", strategy: "url", log: false } as any];
    await runPipeline(items, pipeline, ctx);
    // only possible other logs? but in this run no, check not the dedupe one
    const dedupeCalls = logSpy.mock.calls.filter((c: any[]) => String(c[0]).includes("[dedupe:"));
    expect(dedupeCalls).toHaveLength(0);
  });

  test("dedupe unknown strategy warns and passes through", async () => {
    const items = [makeRow()];
    const pipeline = [{ type: "dedupe", strategy: "weird" } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result).toHaveLength(1);
    // note: the warn is console.warn, not caught by logSpy here
  });

  test("dedupe:domain-normalized with keep:earliest picks the earliest timestamp winner (exercises pickWinner)", async () => {
    const items = [
      makeRow({ id: "early", url: "https://ex.com/a", timestamp: "2024-01-01T00:00:00Z" }),
      makeRow({ id: "late", url: "https://ex.com/a", timestamp: "2024-01-02T00:00:00Z" }),
      makeRow({ id: "b", url: "https://ex.com/b", timestamp: "2024-01-03T00:00:00Z" }),
    ];
    const pipeline = [{ type: "dedupe", strategy: "domain-normalized", keep: "earliest" } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map((r) => r.id)).toEqual(["early", "b"]);
  });

  test("dedupe:domain-normalized with keep:highest-score picks the item with highest extractScore (exercises pickWinner)", async () => {
    const items = [
      makeRow({ id: "low", url: "https://ex.com/a", body: "no score here", timestamp: "2024-01-01T00:00:00Z" }),
      makeRow({ id: "high", url: "https://ex.com/a", body: "upvotes: 42 score: 100", timestamp: "2024-01-02T00:00:00Z" }),
      makeRow({ id: "b", url: "https://ex.com/b" }),
    ];
    const pipeline = [{ type: "dedupe", strategy: "domain-normalized", keep: "highest-score" } as any];
    const result = await runPipeline(items, pipeline, ctx);
    expect(result.map((r) => r.id)).toEqual(["high", "b"]);
  });
});

describe("extractEngagementScore (pure helper, exported + DRYed for iter26)", () => {
  test("returns 0 for null, empty, or whitespace-only body", () => {
    expect(extractEngagementScore(null)).toBe(0);
    expect(extractEngagementScore("")).toBe(0);
    expect(extractEngagementScore("   \t")).toBe(0);
    expect(extractEngagementScore(undefined as any)).toBe(0);
  });

  test("parses primary signals: points, score, upvotes, boosts, stars, likes", () => {
    expect(extractEngagementScore("10 points")).toBe(10);
    expect(extractEngagementScore("score: 42")).toBe(42);
    expect(extractEngagementScore("7 upvotes")).toBe(7);
    expect(extractEngagementScore("3 boosts")).toBe(3);
    expect(extractEngagementScore("5 stars")).toBe(5);
    expect(extractEngagementScore("12 likes")).toBe(12);
  });

  test("parses favorites with both spellings (favou?rites)", () => {
    expect(extractEngagementScore("4 favorites")).toBe(4);
    expect(extractEngagementScore("4 favourites")).toBe(4);
    expect(extractEngagementScore("9 FAVOURITES")).toBe(9);
  });

  test("parses comments as half-value (floor)", () => {
    expect(extractEngagementScore("10 comments")).toBe(5);
    expect(extractEngagementScore("1 comment")).toBe(0);
    expect(extractEngagementScore("3 comments")).toBe(1);
  });

  test("sums multiple different signals in one body", () => {
    expect(extractEngagementScore("20 points + 5 upvotes, 10 comments")).toBe(20 + 5 + 5);
    expect(extractEngagementScore("score: 100, 8 likes, 4 stars")).toBe(100 + 8 + 4);
  });

  test("ignores non-matching text and non-numeric", () => {
    expect(extractEngagementScore("no numbers here at all")).toBe(0);
    expect(extractEngagementScore("points: lots")).toBe(0);
    expect(extractEngagementScore("42")).toBe(0);
  });

  test("case-insensitive and trims around numbers", () => {
    expect(extractEngagementScore("  99 POINTS  ")).toBe(99);
    expect(extractEngagementScore("2 boosts")).toBe(2);
  });
});
