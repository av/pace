import { describe, test, expect } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import {
  initDb,
  saveItems,
  getAllItemsByPanel,
} from "./db";
import { makeContentItem, makeContentItemRow as makeRow } from "./test/content-items";
import { runPipeline, type TransformContext } from "./transforms";
import { dedupeGroupedByKey } from "./dedupe";

installTempDbHooks({ prefix: "pace-adapter-provenance-", init: false, warnOnRmFail: true });

const ctx: TransformContext = { llmModel: null, llmConfig: undefined };

// ---- Provenance: bookmarks items through the pipeline ----

describe("provenance - bookmarks source attribution through pipeline", () => {
  test("bookmarks items retain source field through filter transform", async () => {
    const items = [
      makeRow({ id: "bk1", title: "Dev Tool", source: "bookmarks:tools", body: "A useful tool" }),
      makeRow({ id: "bk2", title: "Recipe Site", source: "bookmarks:food", body: "Cooking recipes" }),
    ];
    const result = await runPipeline(items, [{ type: "filter", keywords: ["tool"] }], ctx);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("bookmarks:tools");
  });

  test("bookmarks items retain source through multi-step pipeline", async () => {
    const items = [
      makeRow({ id: "bk1", title: "Alpha Tool", source: "bookmarks:tools", body: "Build automation" }),
      makeRow({ id: "bk2", title: "Beta Tool", source: "bookmarks:tools", body: "Testing framework" }),
      makeRow({ id: "bk3", title: "Gamma Recipe", source: "bookmarks:food", body: "Pasta dish" }),
    ];
    const steps = [
      { type: "filter", keywords: ["tool"] },
      { type: "sort", field: "title" as const, direction: "asc" as const },
      { type: "latest", count: 1 },
    ];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("bk1");
    expect(result[0].source).toBe("bookmarks:tools");
  });

  test("filter by specific tag in bookmarks source field", async () => {
    const items = [
      makeRow({ id: "bk1", title: "GitHub", source: "bookmarks:tools" }),
      makeRow({ id: "bk2", title: "NYT", source: "bookmarks:news" }),
      makeRow({ id: "bk3", title: "React Docs", source: "bookmarks:docs" }),
    ];
    const steps = [{ type: "filter", keywords: ["tools"], fields: ["source"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("bk1");
    expect(result[0].source).toBe("bookmarks:tools");
  });

  test("filter by tag prefix matches all bookmarks sources", async () => {
    const items = [
      makeRow({ id: "bk1", title: "GitHub", source: "bookmarks:tools" }),
      makeRow({ id: "bk2", title: "NYT", source: "bookmarks:news" }),
      makeRow({ id: "rs1", title: "HN Top", source: "hackernews" }),
    ];
    const steps = [{ type: "filter", keywords: ["bookmarks"], fields: ["source"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.source.startsWith("bookmarks"))).toBe(true);
  });
});

// ---- Provenance: counter items through DB round-trip ----

describe("provenance - counter items source through DB round-trip", () => {
  test("counter item retains source after save and load", () => {
    initDb();
    const item = makeContentItem({
      id: "counter:stars:1718000000",
      title: "GitHub Stars",
      url: "https://api.github.com/repos/org/repo",
      source: "github-stars",
      body: JSON.stringify({ value: 93200, unit: "stars" }),
    });
    saveItems("panel-stats", [item]);
    const rows = getAllItemsByPanel("panel-stats");
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("github-stars");
  });

  test("counter item retains JSON body through save + load + transform", async () => {
    initDb();
    const jsonBody = JSON.stringify({ value: 42000, unit: "stars" });
    const item = makeContentItem({
      id: "counter:stars:roundtrip",
      title: "Stars",
      url: "https://api.github.com/repos/org/repo",
      source: "github-stars",
      body: jsonBody,
    });
    saveItems("panel-stats", [item]);
    const rows = getAllItemsByPanel("panel-stats");
    expect(rows[0].body).toBe(jsonBody);

    // Now run through a non-body-modifying transform
    const result = await runPipeline(rows, [{ type: "latest", count: 10 }], ctx);
    expect(result[0].body).toBe(jsonBody);
    expect(result[0].source).toBe("github-stars");
  });
});

// ---- Provenance: mixed panel attribution ----

describe("provenance - mixed panel attribution", () => {
  test("items from different adapters keep distinct sources in same panel", () => {
    initDb();
    const rssItem = makeContentItem({
      id: "rss-1",
      title: "Tech News",
      url: "https://news.com/1",
      source: "rss:technews",
    });
    const bookmarkItem = makeContentItem({
      id: "bk-1",
      title: "Useful Tool",
      url: "https://tool.com",
      source: "bookmarks:tools",
    });
    const counterItem = makeContentItem({
      id: "counter:dl:1718000000",
      title: "Downloads",
      url: "https://api.npm.io/pkg",
      source: "npm-downloads",
      body: JSON.stringify({ value: 50000 }),
    });

    saveItems("panel-all", [rssItem, bookmarkItem, counterItem]);
    const rows = getAllItemsByPanel("panel-all");
    expect(rows).toHaveLength(3);

    const sources = new Set(rows.map((r) => r.source));
    expect(sources.has("rss:technews")).toBe(true);
    expect(sources.has("bookmarks:tools")).toBe(true);
    expect(sources.has("npm-downloads")).toBe(true);
  });

  test("mixed items retain distinct sources after pipeline transforms", async () => {
    const items = [
      makeRow({ id: "rss1", title: "Tech Article", source: "rss:blog", body: "Technology news" }),
      makeRow({ id: "bk1", title: "Tool Bookmark", source: "bookmarks:tools", body: "Developer tool" }),
      makeRow({ id: "ct1", title: "Star Count", source: "github-stars", body: JSON.stringify({ value: 1000 }) }),
    ];
    const steps = [
      { type: "sort", field: "title" as const, direction: "asc" as const },
    ];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(3);
    // Each retains its original source after sort
    const rss = result.find((r) => r.id === "rss1");
    const bk = result.find((r) => r.id === "bk1");
    const ct = result.find((r) => r.id === "ct1");
    expect(rss!.source).toBe("rss:blog");
    expect(bk!.source).toBe("bookmarks:tools");
    expect(ct!.source).toBe("github-stars");
  });

});

// ---- Edge: dedup between two bookmark adapters ----

describe("edge - dedup between two bookmark adapter instances", () => {
  test("dedupe:url collapses same URL from two different bookmark sources", async () => {
    const items = [
      makeRow({
        id: "bk-tools-github",
        title: "GitHub",
        url: "https://github.com",
        source: "bookmarks:tools",
        body: "Code hosting platform",
      }),
      makeRow({
        id: "bk-daily-github",
        title: "GitHub Homepage",
        url: "https://github.com",
        source: "bookmarks:daily",
        body: "Go-to code site",
      }),
    ];
    const steps = [{ type: "dedupe", strategy: "url", log: false }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("bk-tools-github"); // first wins
    expect(result[0].source).toBe("bookmarks:tools");
  });

  test("dedupe:url with origins merges sources from two bookmark adapters", () => {
    const a = makeRow({
      id: "bk-a",
      url: "https://github.com",
      source: "bookmarks:tools",
      origins: JSON.stringify(["bookmarks:tools"]),
    });
    const b = makeRow({
      id: "bk-b",
      url: "https://github.com",
      source: "bookmarks:daily",
      origins: JSON.stringify(["bookmarks:daily"]),
    });
    const { result } = dedupeGroupedByKey([a, b], (i) => i.url, "first", () => "");
    expect(result).toHaveLength(1);
    const origins = JSON.parse(result[0].origins!);
    expect(origins.sort()).toEqual(["bookmarks:daily", "bookmarks:tools"]);
  });

  test("dedupe:domain-normalized collapses similar URLs from two bookmark sources", async () => {
    const items = [
      makeRow({
        id: "bk-a",
        url: "https://github.com/org/repo",
        source: "bookmarks:tools",
        timestamp: "2024-01-01T00:00:00Z",
      }),
      makeRow({
        id: "bk-b",
        url: "https://GITHUB.COM/org/repo/",
        source: "bookmarks:daily",
        timestamp: "2024-01-02T00:00:00Z",
      }),
    ];
    const steps = [{ type: "dedupe", strategy: "domain-normalized", keep: "latest", log: false }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("bk-b"); // latest kept
  });
});

// ---- Edge: transforms on counter structured JSON body ----

describe("edge - transforms modifying counter structured JSON body", () => {
  test("time-decay annotate appends hot-score to counter JSON body", async () => {
    const now = Date.now();
    const jsonBody = JSON.stringify({ value: 42000, unit: "stars" });
    const items = [
      makeRow({
        id: "ct1",
        title: "Stars",
        source: "github-stars",
        body: jsonBody,
        timestamp: new Date(now - 3600 * 1000).toISOString(),
      }),
    ];
    const steps = [{
      type: "time-decay",
      half_life: "12h",
      engagement_weight: 0.5,
      recency_weight: 0.5,
      annotate: true,
    }];
    const result = await runPipeline(items, steps, ctx);
    // The annotate flag appends a [hot-score:...] line to the body
    expect(result[0].body).toContain(jsonBody);
    expect(result[0].body).toContain("[hot-score:");
    // The original JSON is still there, just with annotation appended
    expect(result[0].body!.startsWith('{"value":')).toBe(true);
  });

  test("keyword-score does not modify counter JSON body", async () => {
    const jsonBody = JSON.stringify({ value: 93200, unit: "stars" });
    const items = [
      makeRow({
        id: "ct1",
        title: "GitHub Stars",
        source: "github-stars",
        body: jsonBody,
      }),
    ];
    const steps = [{
      type: "keyword-score",
      keywords: [{ term: "github", weight: 5 }],
    }];
    const result = await runPipeline(items, steps, ctx);
    // keyword-score sorts but does not mutate body
    expect(result[0].body).toBe(jsonBody);
  });

  test("filter matches keyword inside counter JSON body structure", async () => {
    const items = [
      makeRow({
        id: "ct1",
        title: "Star Count",
        source: "github-stars",
        body: JSON.stringify({ value: 42000, unit: "stars" }),
      }),
      makeRow({
        id: "ct2",
        title: "Issue Count",
        source: "github-issues",
        body: JSON.stringify({ value: 100, unit: "issues" }),
      }),
    ];
    // "stars" appears inside JSON body string as a value
    const steps = [{ type: "filter", keywords: ["stars"] }];
    const result = await runPipeline(items, steps, ctx);
    // ct1 matches on both title ("Star Count" does NOT have "stars") and body (JSON contains "stars")
    // ct2 does not match
    // Actually "stars" is in ct1.body as JSON key value "stars"
    expect(result.some((r) => r.id === "ct1")).toBe(true);
  });

  test("score transform on counter JSON body matches raw text keywords", async () => {
    const items = [
      makeRow({
        id: "ct1",
        title: "Counter A",
        source: "api-counter",
        body: JSON.stringify({ value: 500, category: "downloads", label: "weekly" }),
      }),
      makeRow({
        id: "ct2",
        title: "Counter B",
        source: "api-counter",
        body: JSON.stringify({ value: 200, category: "uploads", label: "monthly" }),
      }),
    ];
    const steps = [{
      type: "keyword-score",
      keywords: [{ term: "downloads", weight: 10 }],
    }];
    const result = await runPipeline(items, steps, ctx);
    // "downloads" appears in ct1's JSON body text
    expect(result[0].id).toBe("ct1");
  });
});



// ---- Edge: limit on counter items ----

describe("edge - limit transform on counter items", () => {
  test("latest limits counter items to specified count", async () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      makeRow({
        id: `ct${i}`,
        title: `Counter ${i}`,
        source: "api-counter",
        body: JSON.stringify({ value: i * 100 }),
      }),
    );
    const result = await runPipeline(items, [{ type: "latest", count: 3 }], ctx);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(["ct0", "ct1", "ct2"]);
  });

  test("latest count larger than available counter items returns all", async () => {
    const items = [
      makeRow({ id: "ct1", title: "Counter 1", source: "api-counter", body: JSON.stringify({ value: 100 }) }),
      makeRow({ id: "ct2", title: "Counter 2", source: "api-counter", body: JSON.stringify({ value: 200 }) }),
    ];
    const result = await runPipeline(items, [{ type: "latest", count: 10 }], ctx);
    expect(result).toHaveLength(2);
  });
});
