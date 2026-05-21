import { describe, test, expect, beforeEach } from "bun:test";
import { runPipeline, type TransformContext } from "./transforms";
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
