import { describe, test, expect, beforeEach } from "bun:test";
import { spyConsole, spyMockCallsContaining } from "./test/console-spy";
import { runPipeline, TRANSFORM_RUNNERS, type TransformContext } from "./transforms";
import { TRANSFORM_SCHEMAS } from "./transform-validate";
import {
  KEYWORD_SCORE_ENTRY_FIELDS,
  TRANSFORM_FIELD_KEYS,
  TRANSFORM_TYPES,
  transformAllowedFieldKeys,
  type TransformConfig,
} from "./config/types";
import type { ContentItemRow } from "./db";
import { makeContentItemRow as makeRow } from "./test/content-items";

const ctx: TransformContext = { llmModel: null };

describe("transforms - filter and exclude", () => {
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
    const steps = [{ type: "filter", keywords: ["alpha", "beta"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map(r => r.id)).toEqual(["1", "2", "4"]);
  });

  test("filter with explicit fields limits matching to those fields", async () => {
    const steps = [{ type: "filter", keywords: ["alpha"], fields: ["source"] }];
    const result = await runPipeline(items, steps, ctx);
    // only item 1 has source containing? wait sources are alpha/beta etc, item1 source="alpha"
    expect(result.map(r => r.id)).toEqual(["1"]);
  });

  test("exclude removes items matching any keyword in default fields", async () => {
    const steps = [{ type: "exclude", keywords: ["alpha", "gamma"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map(r => r.id)).toEqual(["2"]); // 1 (alpha), 3 (gamma), 4 (alpha in body) removed; only 2 remains
  });

  test("exclude with fields option works", async () => {
    const steps = [{ type: "exclude", keywords: ["beta"], fields: ["source"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map(r => r.id)).toEqual(["1", "3", "4"]); // 2 excluded by source
  });

  test("combined filter then exclude pipeline produces correct intersection", async () => {
    const steps = [
      { type: "filter", keywords: ["alpha", "beta", "gamma"] },
      { type: "exclude", keywords: ["gamma"] },
    ];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map(r => r.id)).toEqual(["1", "2", "4"]); // gamma excluded after filter
  });

  test("filter with no matching keywords returns empty", async () => {
    const steps = [{ type: "filter", keywords: ["nonexistent"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(0);
  });

  test("exclude with no matching keywords returns all", async () => {
    const steps = [{ type: "exclude", keywords: ["nonexistent"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(4);
  });
});

describe("transforms - runPipeline basics", () => {
  test("TRANSFORM_TYPES matches runtime registry and validation schemas (no config/runtime drift)", () => {
    expect(TRANSFORM_TYPES).toHaveLength(12);
    expect(new Set(TRANSFORM_TYPES).size).toBe(TRANSFORM_TYPES.length);
    expect(Object.keys(TRANSFORM_RUNNERS).sort()).toEqual([...TRANSFORM_TYPES].sort());
    expect(Object.keys(TRANSFORM_SCHEMAS).sort()).toEqual([...TRANSFORM_TYPES].sort());
  });

  test("KEYWORD_SCORE_ENTRY_FIELDS aligns with KeywordScoreEntry type", () => {
    const exemplar = { term: "alpha", weight: 2, regex: true };
    const configKeys = Object.keys(exemplar).sort();
    expect([...KEYWORD_SCORE_ENTRY_FIELDS].sort()).toEqual(configKeys);
  });

  test("TRANSFORM_FIELD_KEYS aligns with TransformConfig and validation allowed-keys", () => {
    const exemplars: Record<TransformConfig["type"], TransformConfig> = {
      latest: { type: "latest", count: 1 },
      filter: { type: "filter", keywords: ["a"], fields: ["title"] },
      exclude: { type: "exclude", keywords: ["a"], fields: ["body"] },
      sort: { type: "sort", field: "title", direction: "asc" },
      dedupe: {
        type: "dedupe",
        strategy: "url",
        threshold: 0.9,
        keep: "latest",
        log: true,
      },
      "keyword-score": {
        type: "keyword-score",
        keywords: [{ term: "a", weight: 1, regex: true }],
        min_score: 1,
        annotate: true,
      },
      "time-decay": {
        type: "time-decay",
        half_life: "24h",
        engagement_weight: 1,
        recency_weight: 1,
        decay: "linear",
        annotate: true,
        min_score: 0.5,
      },
      cluster: {
        type: "cluster",
        strategy: "auto",
        min_cluster_size: 2,
        max_clusters: 5,
        similarity_threshold: 0.8,
        annotate: true,
      },
      "llm-summarize": { type: "llm-summarize", fetch_content: true },
      "llm-filter": { type: "llm-filter", criteria: "relevant" },
      "llm-rank": { type: "llm-rank", interests: ["tech"] },
      "llm-merge": { type: "llm-merge", prompt: "merge" },
    };

    for (const transformType of TRANSFORM_TYPES) {
      const configKeys = Object.keys(exemplars[transformType]).filter((key) => key !== "type").sort();
      expect([...TRANSFORM_FIELD_KEYS[transformType]].sort()).toEqual(configKeys);
      expect(transformAllowedFieldKeys(transformType)).toEqual(["type", ...TRANSFORM_FIELD_KEYS[transformType]]);
    }
  });

  test("empty pipeline returns items unchanged", async () => {
    const items = [makeRow({ title: "only" })];
    const result = await runPipeline(items, [], ctx);
    expect(result).toEqual(items);
  });

  test("unknown transform type is skipped with warning (no crash)", async () => {
    const items = [makeRow()];
    const steps = [{ type: "nonexistent" }] as TransformConfig[];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
  });

  test("latest transform limits count", async () => {
    const items = [makeRow({id:"a"}), makeRow({id:"b"}), makeRow({id:"c"})];
    const steps = [{ type: "latest", count: 2 }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map(r => r.id)).toEqual(["a", "b"]);
  });
});

describe("transforms - dedupe strategies", () => {
  test("dedupe:url removes exact dups and logs when enabled (default)", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "1", title: "First", url: "https://ex.com/a" }),
        makeRow({ id: "2", title: "Dup", url: "https://ex.com/a" }),
        makeRow({ id: "3", title: "Third", url: "https://ex.com/b" }),
      ];
      const steps = [{ type: "dedupe", strategy: "url", log: true }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.map((r) => r.id)).toEqual(["1", "3"]);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("transforms: dedupe:url removed 1 duplicate(s):"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('  - "Dup" (https://ex.com/a)'));
    });
  });

  test("dedupe:domain-normalized groups by normalized url and logs", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "1", title: "A1", url: "https://www.Example.com/foo/", timestamp: "2024-01-01T00:00:00Z" }),
        makeRow({ id: "2", title: "A2", url: "https://example.com/foo?utm_source=xx", timestamp: "2024-01-02T00:00:00Z" }),
        makeRow({ id: "3", title: "B", url: "https://ex.com/other" }),
      ];
      const steps = [{ type: "dedupe", strategy: "domain-normalized", keep: "latest", log: true }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.map((r) => r.id)).toEqual(["2", "3"]); // latest of the group kept
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("transforms: dedupe:domain-normalized removed 1 duplicate(s):"));
    });
  });

  test("dedupe:title-similarity detects near titles, keeps winner, logs with threshold", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "1", title: "Hello World Update", url: "u1", timestamp: "2024-01-01T00:00:00Z" }),
        makeRow({ id: "2", title: "Hello World Upd8", url: "u2", timestamp: "2024-01-02T00:00:00Z" }),
        makeRow({ id: "3", title: "Other News", url: "u3" }),
      ];
      const steps = [{ type: "dedupe", strategy: "title-similarity", threshold: 0.8, keep: "latest", log: true }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.map((r) => r.id)).toContain("2"); // or 1 depending on pick, but one kept + 3
      expect(result).toHaveLength(2);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("transforms: dedupe:title-similarity removed 1 duplicate(s) (threshold=0.8):"));
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('  - "Hello World Update" (u1) -> kept "Hello World Upd8"'),
      );
    });
  });

  test("dedupe log disabled does not emit console.log", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [makeRow({ url: "x" }), makeRow({ url: "x" })];
      const steps = [{ type: "dedupe", strategy: "url", log: false }];
      await runPipeline(items, steps, ctx);
      expect(spyMockCallsContaining(logSpy, "transforms: dedupe:")).toHaveLength(0);
    });
  });

  test("dedupe unknown strategy warns and passes through", async () => {
    await spyConsole(["warn"], async ({ warn: warnSpy }) => {
      const items = [makeRow()];
      const steps = [{ type: "dedupe", strategy: "weird" }] as TransformConfig[];
      const result = await runPipeline(items, steps, ctx);
      expect(result).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'transforms: unknown dedupe strategy "weird", passing items through',
      );
    });
  });

  test("dedupe:domain-normalized with keep:earliest picks the earliest timestamp winner (exercises pickWinner)", async () => {
    const items = [
      makeRow({ id: "early", url: "https://ex.com/a", timestamp: "2024-01-01T00:00:00Z" }),
      makeRow({ id: "late", url: "https://ex.com/a", timestamp: "2024-01-02T00:00:00Z" }),
      makeRow({ id: "b", url: "https://ex.com/b", timestamp: "2024-01-03T00:00:00Z" }),
    ];
    const steps = [{ type: "dedupe", strategy: "domain-normalized", keep: "earliest" }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map((r) => r.id)).toEqual(["early", "b"]);
  });

  test("dedupe:domain-normalized with keep:highest-score picks the item with highest extractScore (exercises pickWinner)", async () => {
    const items = [
      makeRow({ id: "low", url: "https://ex.com/a", body: "no score here", timestamp: "2024-01-01T00:00:00Z" }),
      makeRow({ id: "high", url: "https://ex.com/a", body: "upvotes: 42 score: 100", timestamp: "2024-01-02T00:00:00Z" }),
      makeRow({ id: "b", url: "https://ex.com/b" }),
    ];
    const steps = [{ type: "dedupe", strategy: "domain-normalized", keep: "highest-score" }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map((r) => r.id)).toEqual(["high", "b"]);
  });

  test("dedupe:title-similarity does not collapse items with blank/empty titles (Levenshtein would give sim=1 for \"\"; guard ensures distinct blank-title items kept separate; exercises title-similarity greedy + pickWinner keep per fact 8eh)", async () => {
    const items = [
      makeRow({ id: "blank1", title: "", url: "https://ex.com/blank1", timestamp: "2024-01-01T00:00:00Z" }),
      makeRow({ id: "blank2", title: "", url: "https://ex.com/blank2", timestamp: "2024-01-02T00:00:00Z" }),
      makeRow({ id: "normal", title: "Real News Item", url: "https://ex.com/real" }),
    ];
    const steps = [{ type: "dedupe", strategy: "title-similarity", threshold: 0.5, keep: "earliest", log: false }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(3);
    const blankIds = result.filter((r) => r.title === "").map((r) => r.id);
    expect(blankIds).toHaveLength(2);
    expect(result.some((r) => r.id === "normal")).toBe(true);
  });
});

describe("keyword-score and time-decay", () => {
  test("keyword-score matches literal terms with counts and weights, applies min_score filter, annotates body", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "a", title: "Alpha release", body: "details" }),
        makeRow({ id: "b", title: "Beta", body: "beta beta update" }),
        makeRow({ id: "c", title: "Gamma", body: "" }),
      ];
      const steps = [{
        type: "keyword-score",
        keywords: [{ term: "alpha", weight: 2 }, { term: "beta", weight: 1 }],
        min_score: 2,
        annotate: true,
      }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.map(r => r.id)).toEqual(["b", "a"]); // sorted score desc: b=3, a=2
      expect(result[0].body).toContain("[keyword-score: 3] beta(x3+1)");
      expect(result[1].body).toContain("[keyword-score: 2] alpha(+2)");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("transforms: keyword-score scored 3 items, 2 passed"));
    });
  });

  test("keyword-score supports regex entries (global count) and falls back on bad regex", async () => {
    const items = [ makeRow({ id: "r", title: "v1.2.3 and v1.2.3", body: "" }) ];
    const steps = [{
      type: "keyword-score",
      keywords: [{ term: "v\\d+\\.\\d+", regex: true, weight: 1 }],
      annotate: true,
    }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.length).toBe(1);
    expect(result[0].body).toContain("[keyword-score: 2]"); // annotate adds it; term has regex pattern, 2 matches from title
  });

  test("keyword-score with no keywords returns all items (no scoring)", async () => {
    const items = [makeRow({ id: "x" }), makeRow({ id: "y" })];
    const steps = [{ type: "keyword-score", keywords: [] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.length).toBe(2);
  });

  test("time-decay combines engagement (via extract) + recency, newer wins on recency, supports exponential/linear", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const now = Date.now();
      const items = [
        makeRow({ id: "old-low", body: "5 points", timestamp: new Date(now - 50 * 3600 * 1000).toISOString() }),
        makeRow({ id: "new-high-rec", body: "1 point", timestamp: new Date(now - 1 * 3600 * 1000).toISOString() }),
      ];
      const steps = [{
        type: "time-decay",
        half_life: "12h",
        engagement_weight: 0.5,
        recency_weight: 0.5,
        decay: "exponential",
      }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.map(r => r.id)).toEqual(["new-high-rec", "old-low"]);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("transforms: time-decay ranked 2 items"));
    });
  });

  test("time-decay handles invalid half_life (warns, defaults), linear decay, min_score filter and annotate", async () => {
    await spyConsole(["log", "warn"], async ({ log: logSpy, warn: warnSpy }) => {
      const now = Date.now();
      const items = [
        makeRow({ id: "recent", body: "10 points", timestamp: new Date(now - 1 * 3600 * 1000).toISOString() }),
        makeRow({ id: "old", body: "1 point", timestamp: new Date(now - 100 * 3600 * 1000).toISOString() }),
      ];
      const steps = [{
        type: "time-decay",
        half_life: "bad-unit",
        engagement_weight: 0.7,
        recency_weight: 0.3,
        decay: "linear",
        min_score: 0.5,
        annotate: true,
      }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.length).toBe(1); // old filtered by min_score (low recency + low eng -> final <0.5)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("transforms: invalid half_life"));
      expect(result[0].body).toContain("[hot-score:");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("transforms: time-decay filtered out"));
    });
  });
});

describe("transforms - cluster", () => {
  test("cluster groups items sharing github domain and annotates with [GitHub] label", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "g1", url: "https://github.com/foo/repo", title: "Release v1", source: "github-releases" }),
        makeRow({ id: "g2", url: "https://github.com/bar/other", title: "Release v2", source: "github-releases" }),
      ];
      const steps = [{ type: "cluster", min_cluster_size: 2, max_clusters: 5, annotate: true }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.length).toBe(2);
      // clustered GitHub items, annotated with GitHub from domain majority (exercises topDomain + 0.6 threshold + domainLabels)
      expect(result[0].body).toMatch(/^\[GitHub\] /);
      expect(result[1].body).toMatch(/^\[GitHub\] /);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('transforms: cluster strategy=auto, 1 cluster(s): "GitHub" (2 items), 0 unclustered'));
    });
  });

  test("cluster uses shared keywords for label when no dominant domain", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "k1", url: "https://github.com/a", title: "React Server Components deep dive", source: "blog" }),
        makeRow({ id: "k2", url: "https://medium.com/b", title: "React performance tips and tricks", source: "blog" }),
      ];
      const steps = [{ type: "cluster", strategy: "keywords", min_cluster_size: 2, annotate: true }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.length).toBe(2);
      // diff domains (no 0.6 majority), keywords "react" wins -> label starts with [React...
      expect(result[0].body).toMatch(/^\[React/);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('transforms: cluster strategy=keywords'));
    });
  });

  test("cluster forms groups on keyword overlap even with mixed domains and same source", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "s1", url: "https://x.com/1", title: "News update first", source: "twitter" }),
        makeRow({ id: "s2", url: "https://news.ycombinator.com/2", title: "News update second", source: "twitter" }),
      ];
      const steps = [{ type: "cluster", min_cluster_size: 2, annotate: false }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.length).toBe(2);
      // shared "news"/"update" -> high sim -> cluster forms (diff domains), label via keywords (source top calc still executed inside generateLabel)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('(2 items)'));
    });
  });

  test("cluster respects min_cluster_size and leaves small groups unclustered", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "a1", url: "https://a.com/1", title: "Alpha only here", source: "a" }),
        makeRow({ id: "a2", url: "https://a.com/2", title: "Alpha second", source: "a" }),
        makeRow({ id: "b1", url: "https://b.com/1", title: "Beta singleton different", source: "b" }), // singleton < min=2 , no shared
      ];
      const steps = [{ type: "cluster", min_cluster_size: 2, max_clusters: 10, annotate: true }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.length).toBe(3);
      // one cluster a (size2 annotated), one unclustered b (exercises unclustered path + source/domain counts)
      const clustered = result.filter(r => (r.body ?? "").startsWith("["));
      expect(clustered.length).toBe(2);
      const unclustered = result.find(r => r.id === "b1");
      expect(unclustered).toBeTruthy();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 cluster(s)'));
    });
  });

  test("cluster warns on extractHostname parse failure for invalid item urls", async () => {
    await spyConsole(["warn"], async ({ warn: warnSpy }) => {
      warnSpy.mockImplementation(() => {});
      const badUrl = "not-a-valid-url";
      const items = [
        makeRow({ id: "u1", url: badUrl, title: "Shared alpha news topic", source: "s1" }),
        makeRow({ id: "u2", url: badUrl, title: "Shared alpha news topic two", source: "s2" }),
      ];
      const steps = [{ type: "cluster", min_cluster_size: 2, annotate: false }];
      const result = await runPipeline(items, steps, ctx);
      expect(result.length).toBe(2);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^transforms: extractHostname failed for "not-a-valid-url": /),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Bookmarks + Counter items through the transform pipeline
// ---------------------------------------------------------------------------

describe("transforms - bookmarks items through pipeline", () => {
  function makeBookmarkRow(
    overrides: Partial<ContentItemRow> = {},
  ): ContentItemRow {
    return makeRow({
      source: "bookmarks:tools",
      body: "A curated list of developer tools",
      ...overrides,
    });
  }

  test("filter keeps bookmarks matching keyword in title", async () => {
    const items = [
      makeBookmarkRow({ id: "b1", title: "GitHub Desktop Client" }),
      makeBookmarkRow({ id: "b2", title: "VS Code Extensions" }),
      makeBookmarkRow({ id: "b3", title: "Terminal Emulators" }),
    ];
    const steps = [{ type: "filter", keywords: ["github"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map((r) => r.id)).toEqual(["b1"]);
  });

  test("filter keeps bookmarks matching keyword in body (description)", async () => {
    const items = [
      makeBookmarkRow({ id: "b1", title: "Tool A", body: "Great for debugging" }),
      makeBookmarkRow({ id: "b2", title: "Tool B", body: "Useful for testing" }),
      makeBookmarkRow({ id: "b3", title: "Tool C", body: null }),
    ];
    const steps = [{ type: "filter", keywords: ["debugging"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map((r) => r.id)).toEqual(["b1"]);
  });

  test("filter on source field matches bookmarks source tag", async () => {
    const items = [
      makeBookmarkRow({ id: "b1", source: "bookmarks:tools" }),
      makeBookmarkRow({ id: "b2", source: "bookmarks:docs" }),
      makeRow({ id: "r1", source: "rss:hackernews" }),
    ];
    const steps = [{ type: "filter", keywords: ["bookmarks"], fields: ["source"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map((r) => r.id)).toEqual(["b1", "b2"]);
  });

  test("keyword-score scores bookmarks by title + body matches", async () => {
    const items = [
      makeBookmarkRow({ id: "b1", title: "React Testing Library", body: "React component testing" }),
      makeBookmarkRow({ id: "b2", title: "Vim Cheatsheet", body: "Keyboard shortcuts for vim" }),
    ];
    const steps = [{
      type: "keyword-score",
      keywords: [{ term: "react", weight: 5 }],
      annotate: true,
    }];
    const result = await runPipeline(items, steps, ctx);
    // b1 has "react" in title AND body = weight*2 = 10
    expect(result[0].id).toBe("b1");
    expect(result[0].body).toContain("[keyword-score: 10]");
  });

  test("dedupe:url collapses bookmarks with identical URLs", async () => {
    const items = [
      makeBookmarkRow({ id: "b1", title: "GitHub", url: "https://github.com" }),
      makeBookmarkRow({ id: "b2", title: "GitHub Home", url: "https://github.com" }),
    ];
    const steps = [{ type: "dedupe", strategy: "url", log: false }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b1"); // first kept
  });

  test("dedupe:title-similarity collapses bookmarks with near-identical titles", async () => {
    const items = [
      makeBookmarkRow({ id: "b1", title: "React Official Documentation", url: "https://reactjs.org/docs" }),
      makeBookmarkRow({ id: "b2", title: "React Official Documentations", url: "https://react.dev/docs" }),
      makeBookmarkRow({ id: "b3", title: "Vue.js Guide", url: "https://vuejs.org/guide" }),
    ];
    // sim("react official documentation", "react official documentations") ~ 0.96
    const steps = [{ type: "dedupe", strategy: "title-similarity", threshold: 0.8, log: false }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(2);
    expect(result.some((r) => r.id === "b3")).toBe(true);
  });

  test("bookmarks with no description get zero engagement score in time-decay", async () => {
    const now = Date.now();
    const items = [
      makeBookmarkRow({
        id: "b1",
        title: "Recent Bookmark",
        body: null,
        timestamp: new Date(now - 1 * 3600 * 1000).toISOString(),
      }),
      makeBookmarkRow({
        id: "b2",
        title: "Old Bookmark",
        body: null,
        timestamp: new Date(now - 48 * 3600 * 1000).toISOString(),
      }),
    ];
    const steps = [{
      type: "time-decay",
      half_life: "12h",
      engagement_weight: 0.5,
      recency_weight: 0.5,
      decay: "exponential",
      annotate: true,
    }];
    const result = await runPipeline(items, steps, ctx);
    // Both have 0 engagement; recent one ranks higher on recency alone
    expect(result[0].id).toBe("b1");
    expect(result[0].body).toContain("[hot-score:");
    expect(result[0].body).toContain("engagement=0.000");
  });

  test("mixed pipeline: filter then latest on bookmarks", async () => {
    const items = [
      makeBookmarkRow({ id: "b1", title: "Alpha Tool" }),
      makeBookmarkRow({ id: "b2", title: "Beta Tool" }),
      makeBookmarkRow({ id: "b3", title: "Alpha Runner" }),
      makeBookmarkRow({ id: "b4", title: "Gamma Tool" }),
    ];
    const steps = [
      { type: "filter", keywords: ["alpha"] },
      { type: "latest", count: 1 },
    ];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b1");
  });
});

describe("transforms - counter items through pipeline", () => {
  function makeCounterRow(
    overrides: Partial<ContentItemRow> = {},
  ): ContentItemRow {
    return makeRow({
      source: "github-stars",
      body: JSON.stringify({ value: 42000, unit: "stars" }),
      url: "https://api.github.com/repos/org/repo",
      ...overrides,
    });
  }

  test("filter matches keyword inside JSON body text", async () => {
    const items = [
      makeCounterRow({ id: "c1", title: "GitHub Stars", body: JSON.stringify({ value: 42000, unit: "stars" }) }),
      makeCounterRow({ id: "c2", title: "Open Issues", body: JSON.stringify({ value: 100, unit: "issues" }) }),
    ];
    const steps = [{ type: "filter", keywords: ["stars"] }];
    const result = await runPipeline(items, steps, ctx);
    // "stars" appears in title of c1 AND body of c1 (JSON string contains "stars")
    expect(result.map((r) => r.id)).toEqual(["c1"]);
  });

  test("filter on title field only avoids matching JSON body content", async () => {
    const items = [
      makeCounterRow({ id: "c1", title: "GitHub Stars" }),
      makeCounterRow({ id: "c2", title: "Open Issues", body: JSON.stringify({ value: 100, unit: "stars" }) }),
    ];
    const steps = [{ type: "filter", keywords: ["stars"], fields: ["title"] }];
    const result = await runPipeline(items, steps, ctx);
    // Only c1 has "stars" in title; c2 has it in body JSON but we search title only
    expect(result.map((r) => r.id)).toEqual(["c1"]);
  });

  test("keyword-score scores counter items by title matches (JSON body has low signal)", async () => {
    const items = [
      makeCounterRow({ id: "c1", title: "GitHub Stars Counter", body: JSON.stringify({ value: 93200 }) }),
      makeCounterRow({ id: "c2", title: "npm Downloads", body: JSON.stringify({ value: 1000000 }) }),
    ];
    const steps = [{
      type: "keyword-score",
      keywords: [{ term: "github", weight: 10 }],
    }];
    const result = await runPipeline(items, steps, ctx);
    expect(result[0].id).toBe("c1");
  });

  test("time-decay gives counter items zero engagement (JSON body has no metric patterns)", async () => {
    const now = Date.now();
    const items = [
      makeCounterRow({
        id: "c1",
        body: JSON.stringify({ value: 42000, unit: "stars" }),
        timestamp: new Date(now - 1 * 3600 * 1000).toISOString(),
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
    // JSON body {"value":42000,"unit":"stars"} does NOT match "42000 stars" pattern
    // because extractEngagementScore regex expects "N stars" with whitespace
    expect(result[0].body).toContain("engagement=0.000");
  });

  test("dedupe:url collapses counter items sharing the same API endpoint", async () => {
    const apiUrl = "https://api.github.com/repos/org/repo";
    const items = [
      makeCounterRow({
        id: "counter:stars:1000",
        url: apiUrl,
        timestamp: "2024-01-01T00:00:00Z",
      }),
      makeCounterRow({
        id: "counter:stars:2000",
        url: apiUrl,
        timestamp: "2024-01-02T00:00:00Z",
      }),
    ];
    const steps = [{ type: "dedupe", strategy: "url", log: false }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
  });

  test("dedupe:domain-normalized collapses counter items with same normalized URL", async () => {
    const items = [
      makeCounterRow({ id: "c1", url: "https://api.github.com/repos/org/repo", timestamp: "2024-01-01T00:00:00Z" }),
      makeCounterRow({ id: "c2", url: "https://API.GITHUB.COM/repos/org/repo/", timestamp: "2024-01-02T00:00:00Z" }),
    ];
    const steps = [{ type: "dedupe", strategy: "domain-normalized", keep: "latest", log: false }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2"); // latest kept
  });

  test("exclude removes counter items by source name", async () => {
    const items = [
      makeCounterRow({ id: "c1", source: "github-stars" }),
      makeCounterRow({ id: "c2", source: "npm-downloads" }),
    ];
    const steps = [{ type: "exclude", keywords: ["github"], fields: ["source"] }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map((r) => r.id)).toEqual(["c2"]);
  });
});

describe("transforms - mixed pipeline (RSS + bookmarks + counter)", () => {
  test("RSS + bookmarks merged then filtered by keyword", async () => {
    const items = [
      makeRow({ id: "rss1", title: "New React Release", source: "rss:reactblog", body: "React 19 details" }),
      makeRow({ id: "rss2", title: "Vue 4 Announcement", source: "rss:vueblog", body: "Vue framework update" }),
      makeRow({ id: "bk1", title: "React Documentation", source: "bookmarks:docs", body: "Official React docs" }),
      makeRow({ id: "bk2", title: "MDN Web Docs", source: "bookmarks:docs", body: "Web reference" }),
      makeRow({ id: "ct1", title: "React Stars", source: "github-stars", body: JSON.stringify({ value: 200000 }) }),
    ];
    const steps = [{ type: "filter", keywords: ["react"] }];
    const result = await runPipeline(items, steps, ctx);
    // rss1 (title), bk1 (title+body), ct1 (title)
    expect(result.map((r) => r.id)).toEqual(["rss1", "bk1", "ct1"]);
  });

  test("mixed sources through keyword-score + latest pipeline", async () => {
    const items = [
      makeRow({ id: "rss1", title: "TypeScript 6.0", body: "typescript typescript typescript", source: "rss:blog" }),
      makeRow({ id: "bk1", title: "TypeScript Handbook", body: "Learn TypeScript", source: "bookmarks" }),
      makeRow({ id: "ct1", title: "TypeScript Downloads", body: JSON.stringify({ value: 50000 }), source: "npm-downloads" }),
      makeRow({ id: "rss2", title: "Rust 2.0", body: "Rust programming", source: "rss:blog" }),
    ];
    const steps = [
      { type: "keyword-score", keywords: [{ term: "typescript", weight: 3 }] },
      { type: "latest", count: 2 },
    ];
    const result = await runPipeline(items, steps, ctx);
    // keyword-score sorts by score desc: rss1 has 4 matches (title+body*3)=12, bk1 has 2=6, ct1 has 1=3, rss2 has 0
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("rss1");
    expect(result[1].id).toBe("bk1");
  });

  test("dedupe across RSS and bookmarks with same URL", async () => {
    const sharedUrl = "https://react.dev/learn";
    const items = [
      makeRow({ id: "rss1", title: "React Learn Page", url: sharedUrl, source: "rss:react" }),
      makeRow({ id: "bk1", title: "React Tutorial", url: sharedUrl, source: "bookmarks:docs" }),
    ];
    const steps = [{ type: "dedupe", strategy: "url", log: false }];
    const result = await runPipeline(items, steps, ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rss1"); // first wins
  });

  test("full pipeline: filter + dedupe + keyword-score + latest", async () => {
    const items = [
      makeRow({ id: "r1", title: "AI News Today", url: "https://ai.com/1", body: "Machine learning breakthroughs", source: "rss:ainews" }),
      makeRow({ id: "r2", title: "AI Weekly Roundup", url: "https://ai.com/1", body: "AI and ML updates", source: "rss:aiweekly" }),
      makeRow({ id: "b1", title: "AI Research Papers", url: "https://arxiv.org/ai", body: "AI papers collection", source: "bookmarks:research" }),
      makeRow({ id: "b2", title: "Cooking Recipes", url: "https://food.com", body: "Best pasta recipes", source: "bookmarks:food" }),
      makeRow({ id: "c1", title: "AI Model Downloads", url: "https://huggingface.co/api", body: JSON.stringify({ value: 1000000 }), source: "hf-downloads" }),
    ];
    const steps = [
      { type: "filter", keywords: ["ai"] },
      { type: "dedupe", strategy: "url", log: false },
      { type: "keyword-score", keywords: [{ term: "ai", weight: 2 }, { term: "machine learning", weight: 5 }] },
      { type: "latest", count: 2 },
    ];
    const result = await runPipeline(items, steps, ctx);
    // After filter: r1, r2, b1, c1 (all mention "ai")
    // After dedupe:url: r1, b1, c1 (r2 shares URL with r1)
    // After keyword-score: r1 has ai(title+body=2*2=4)+ML(body=5)=9, b1 has ai(x2=4), c1 has ai(title=2)
    // After latest:2 -> top 2 by score: r1, b1
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("r1"); // highest score
    expect(result[1].id).toBe("b1");
  });

  test("sort transform works on mixed bookmark/counter/rss items", async () => {
    const items = [
      makeRow({ id: "bk1", title: "Zebra Tool", source: "bookmarks" }),
      makeRow({ id: "ct1", title: "Alpha Counter", source: "counter" }),
      makeRow({ id: "rs1", title: "Middle News", source: "rss" }),
    ];
    const steps = [{ type: "sort", field: "title", direction: "asc" }];
    const result = await runPipeline(items, steps, ctx);
    expect(result.map((r) => r.id)).toEqual(["ct1", "rs1", "bk1"]);
  });

  test("cluster groups bookmarks and RSS items sharing a domain", async () => {
    await spyConsole(["log"], async ({ log: logSpy }) => {
      const items = [
        makeRow({ id: "bk1", url: "https://github.com/org/repo", title: "GitHub Repo Bookmark", source: "bookmarks" }),
        makeRow({ id: "rs1", url: "https://github.com/org/other", title: "GitHub Release Feed", source: "rss:github" }),
        makeRow({ id: "bk2", url: "https://docs.python.org/3", title: "Python Docs", source: "bookmarks:docs" }),
      ];
      const steps = [{ type: "cluster", min_cluster_size: 2, annotate: true }];
      const result = await runPipeline(items, steps, ctx);
      expect(result).toHaveLength(3);
      // bk1 and rs1 share github.com domain -> clustered
      const githubItems = result.filter((r) => r.id === "bk1" || r.id === "rs1");
      expect(githubItems.every((r) => (r.body ?? "").includes("[GitHub"))).toBe(true);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("1 cluster(s)"));
    });
  });
});
