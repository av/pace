import { describe, test, expect } from "bun:test";
import {
  BRIEF_SCHEMA,
  BRIEF_SUMMARY_MAX_CHARS,
  briefConfigLabel,
  buildBrief,
  buildBriefContext,
  capBriefText,
  estimateBriefTokens,
  parseBriefBody,
  parseBriefLimit,
  parseBriefPerPanel,
  parseBriefSince,
  renderBriefJson,
  renderBriefMarkdown,
  resolveBriefPanelIds,
  type BriefContext,
  type BriefOptions,
} from "./brief";
import { replacePanelItems, saveItems } from "./db";
import { makeContentItem, makeContentItemRow } from "./test/content-items";
import { installTempDbHooks } from "./test/temp-db";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import type { AppConfig } from "./config/types";

installTempDbHooks({ prefix: "pace-brief-" });

// Fixed and in the past: stored timestamps are clamped against the real
// clock, so fixtures must never be "future" relative to it.
const NOW = new Date("2026-01-15T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function briefConfig(): AppConfig {
  return {
    adapters: [
      { name: "hn", type: "hackernews", params: {} },
      { name: "blog", type: "rss", params: { urls: ["https://blog.example/feed"] } },
      { name: "links", type: "bookmarks", params: { items: [] } },
    ],
    pipelines: [{ name: "hot", sources: ["hn", "blog"], transforms: [] }],
    layout: flexCfg("row", [
      panelCfg("Hacker News", "hn", { id: "hn-panel" }),
      panelCfg("Blog", "blog", { id: "blog-panel" }),
      panelCfg("Hot", "hot", { id: "hot-panel" }),
      panelCfg("Links", "links", { id: "links-panel" }),
      panelCfg("Everything", { adapter: "all" }, { id: "all-panel" }),
    ]),
  } as AppConfig;
}

function ctx(): BriefContext {
  return buildBriefContext(briefConfig(), "preset:test");
}

function options(overrides: Partial<BriefOptions> = {}): BriefOptions {
  const since = parseBriefSince("72h", NOW);
  if (!since.ok) throw new Error(since.error);
  return { limit: 40, perPanel: 8, since: since.value, ...overrides };
}

function hn(id: string, title: string, points: number, comments: number, h: number) {
  return makeContentItem({
    id,
    title,
    url: `https://news.example/${id}`,
    source: "hackernews:top",
    body: `${points} points | by someone | ${comments} comments | discuss: https://news.ycombinator.com/item?id=${id}`,
    timestamp: hoursAgo(h),
  });
}

describe("brief schema", () => {
  test("header and item fields follow pace.brief/v1", () => {
    saveItems("hn-panel", [hn("a1", "Open weights model tops the leaderboard", 400, 120, 3)]);
    const doc = buildBrief(ctx(), options(), NOW);

    expect(doc.schema).toBe(BRIEF_SCHEMA);
    expect(doc.schema).toBe("pace.brief/v1");
    expect(doc.generated_at).toBe("2026-01-15T12:00:00Z");
    expect(doc.config).toBe("preset:test");
    expect(doc.scope).toEqual({
      panels: ["hn-panel", "blog-panel", "hot-panel", "all-panel"],
      skipped_panels: ["links-panel"],
      since: "2026-01-12T12:00:00Z",
      window: "72h",
      limit: 40,
      per_panel: 8,
    });
    expect(Object.keys(doc.counts).sort()).toEqual(
      ["candidates", "cut_by_limits", "duplicates_merged", "older_than_window", "panels", "selected"],
    );
    expect(doc.token_estimate.method).toBe("chars/4");
    expect(doc.token_estimate.markdown).toBeGreaterThan(0);
    expect(doc.token_estimate.json).toBeGreaterThan(0);
    expect(doc.panels.map((p) => p.id)).toEqual(doc.scope.panels);
    expect(Object.keys(doc.panels[0]!).sort()).toEqual(
      ["candidates", "id", "kind", "last_refreshed_at", "listed_elsewhere", "name", "older_than_window", "selected"],
    );

    expect(doc.items).toHaveLength(1);
    const item = doc.items[0]!;
    expect(Object.keys(item).sort()).toEqual([
      "also_in", "discussion_url", "engagement", "fetched_at", "id", "llm_score", "n", "panel",
      "panel_name", "published_at", "score", "source", "summary", "title", "url", "why_ranked",
    ]);
    expect(item).toMatchObject({
      n: 1,
      id: "a1",
      title: "Open weights model tops the leaderboard",
      url: "https://news.example/a1",
      source: "hackernews:top",
      panel: "hn-panel",
      panel_name: "Hacker News",
      llm_score: null,
      engagement: { points: 400, comments: 120 },
      summary: null,
      discussion_url: "https://news.ycombinator.com/item?id=a1",
    });
    expect(item.published_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(item.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  test("token estimates are chars/4 of each rendering", () => {
    saveItems("hn-panel", [hn("a1", "Open weights model tops the leaderboard", 400, 120, 3)]);
    const c = ctx();
    const doc = buildBrief(c, options(), NOW);
    expect(Math.abs(doc.token_estimate.markdown - estimateBriefTokens(renderBriefMarkdown(doc, c)))).toBeLessThanOrEqual(1);
    expect(Math.abs(doc.token_estimate.json - estimateBriefTokens(renderBriefJson(doc)))).toBeLessThanOrEqual(1);
    expect(estimateBriefTokens("abcdefgh")).toBe(2);
    expect(estimateBriefTokens("abcdefghi")).toBe(3);
  });

  test("config labels name presets and never leak directories", () => {
    expect(briefConfigLabel("/app/presets/config.ml-ai.yaml")).toBe("preset:ml-ai");
    expect(briefConfigLabel("ml-ai")).toBe("preset:ml-ai");
    expect(briefConfigLabel("/home/me/secret/dash.yaml")).toBe("dash.yaml");
    expect(briefConfigLabel(undefined, () => true)).toBe("config.yaml");
    expect(briefConfigLabel(undefined, () => false)).toBe("config.example.yaml");
  });
});

describe("brief scope", () => {
  test("skips bookmark/counter panels by default and drops items older than the window", () => {
    saveItems("hn-panel", [
      hn("new", "A fresh story about inference speedups", 50, 5, 2),
      hn("old", "An old story about inference speedups", 900, 400, 100),
    ]);
    saveItems("links-panel", [makeContentItem({ id: "l1", title: "Hugging Face", url: "https://hf.co", timestamp: hoursAgo(1) })]);

    const doc = buildBrief(ctx(), options(), NOW);
    expect(doc.items.map((i) => i.id)).toEqual(["new"]);
    expect(doc.scope.skipped_panels).toEqual(["links-panel"]);
    const hnPanel = doc.panels.find((p) => p.id === "hn-panel")!;
    expect(hnPanel.older_than_window).toBe(1);
    expect(doc.counts.older_than_window).toBeGreaterThanOrEqual(1);
  });

  test("a panel filter can name a reference panel explicitly", () => {
    saveItems("links-panel", [makeContentItem({ id: "l1", title: "Hugging Face", url: "https://hf.co", timestamp: hoursAgo(1) })]);
    const doc = buildBrief(ctx(), options({ panelIds: ["links-panel"] }), NOW);
    expect(doc.scope.panels).toEqual(["links-panel"]);
    expect(doc.items.map((i) => i.id)).toEqual(["l1"]);
  });

  test("candidates come from the panel view, bounded by the panel limit", () => {
    const config = briefConfig();
    (config.layout as any).children[0].limit = 2;
    saveItems("hn-panel", [
      hn("a", "Story number one about models", 1, 0, 1),
      hn("b", "Story number two about models", 1, 0, 2),
      hn("c", "Story number three about models", 1, 0, 3),
    ]);
    const doc = buildBrief(buildBriefContext(config, "x"), options({ panelIds: ["hn-panel"] }), NOW);
    expect(doc.panels[0]!.candidates).toBe(2);
    expect(doc.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  test("since=all keeps everything; durations and ISO dates set the cutoff", () => {
    const all = parseBriefSince("all", NOW);
    expect(all).toEqual({ ok: true, value: { cutoff: null, label: "all" } });
    const day = parseBriefSince("24h", NOW);
    expect(day.ok && day.value.cutoff?.toISOString()).toBe("2026-01-14T12:00:00.000Z");
    const week = parseBriefSince("1w", NOW);
    expect(week.ok && week.value.cutoff?.toISOString()).toBe("2026-01-08T12:00:00.000Z");
    const minutes = parseBriefSince("90m", NOW);
    expect(minutes.ok && minutes.value.label).toBe("90m");
    const iso = parseBriefSince("2026-09-25", NOW);
    expect(iso.ok && iso.value.label).toBe("since 2026-09-25T00:00:00.000Z");
    const dflt = parseBriefSince(undefined, NOW);
    expect(dflt.ok && dflt.value.label).toBe("72h");
    for (const bad of ["yesterday", "0h", "5y", "", "2026-13-45"]) {
      expect(parseBriefSince(bad, NOW).ok).toBe(false);
    }
  });

  test("limit and per_panel are bounded integers with defaults", () => {
    expect(parseBriefLimit(undefined)).toEqual({ ok: true, value: 40 });
    expect(parseBriefLimit("200")).toEqual({ ok: true, value: 200 });
    expect(parseBriefLimit("201")).toEqual({ ok: false, error: "limit must be between 1 and 200" });
    expect(parseBriefLimit("x")).toEqual({ ok: false, error: "limit must be a positive integer" });
    expect(parseBriefPerPanel(undefined)).toEqual({ ok: true, value: 8 });
    expect(parseBriefPerPanel("0")).toEqual({ ok: false, error: "per_panel must be between 1 and 50" });
  });

  test("panel filters resolve ids and display names, repeated or comma-separated", () => {
    const c = ctx();
    expect(resolveBriefPanelIds([], c)).toEqual({ ok: true, value: undefined });
    expect(resolveBriefPanelIds(["Blog,hn-panel", "Blog"], c)).toEqual({ ok: true, value: ["blog-panel", "hn-panel"] });
    expect(resolveBriefPanelIds(["nope"], c)).toEqual({ ok: false, error: "Unknown panel: nope" });
  });
});

describe("brief dedupe", () => {
  test("one story across panels is listed once, homed on its adapter panel", () => {
    const story = hn("s1", "New open weights model released today", 300, 90, 4);
    saveItems("hn-panel", [story]);
    saveItems("hot-panel", [{ ...story, id: "pipeline:hot:s1" }]);

    const doc = buildBrief(ctx(), options(), NOW);
    const matches = doc.items.filter((i) => i.url === "https://news.example/s1");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.panel).toBe("hn-panel");
    expect(matches[0]!.also_in).toEqual(["Hot", "Everything"]);
    expect(doc.counts.duplicates_merged).toBe(2);
    const hot = doc.panels.find((p) => p.id === "hot-panel")!;
    expect(hot.kind).toBe("pipeline");
    expect(hot.listed_elsewhere).toBe(1);
    expect(doc.panels.find((p) => p.id === "all-panel")!.kind).toBe("all");
  });

  test("the same long title under different URLs merges; short titles do not", () => {
    saveItems("hn-panel", [
      hn("t1", "Researchers release a 1B parameter reasoning model", 100, 10, 2),
      hn("t2", "Weekly notes", 5, 1, 2),
    ]);
    saveItems("blog-panel", [
      makeContentItem({ id: "b1", title: "Researchers release a 1B-parameter reasoning model!", url: "https://blog.example/1b", timestamp: hoursAgo(3) }),
      makeContentItem({ id: "b2", title: "Weekly notes", url: "https://blog.example/weekly", timestamp: hoursAgo(3) }),
    ]);
    const doc = buildBrief(ctx(), options({ panelIds: ["hn-panel", "blog-panel"] }), NOW);
    expect(doc.items.map((i) => i.id).sort()).toEqual(["b2", "t1", "t2"]);
    expect(doc.items.find((i) => i.id === "t1")!.also_in).toEqual(["Blog"]);
  });
});

describe("brief rank", () => {
  test("scores blend engagement, recency and cross-panel presence deterministically", () => {
    saveItems("hn-panel", [
      hn("big", "Big story with lots of discussion here", 1000, 500, 10),
      hn("small", "Small story with little discussion", 10, 1, 10),
    ]);
    const a = buildBrief(ctx(), options({ panelIds: ["hn-panel"] }), NOW);
    const b = buildBrief(ctx(), options({ panelIds: ["hn-panel"] }), NOW);
    expect(renderBriefJson(a)).toBe(renderBriefJson(b));
    const big = a.items.find((i) => i.id === "big")!;
    const small = a.items.find((i) => i.id === "small")!;
    // engagement 1.0*0.4 + recency 2^(-10/24)*0.4 = 0.4 + 0.3002 → 70
    expect(big.score).toBe(70);
    expect(small.score).toBeLessThan(big.score);
    expect(a.items[0]!.id).toBe("big");
    expect(big.why_ranked).toEqual(["1000 points, 500 comments", "published 10h ago"]);
  });

  test("a stored llm-rank score is averaged in and named in why_ranked", () => {
    replacePanelItems("blog-panel", [
      makeContentItemRow({ id: "r1", panel_id: "blog-panel", title: "Ranked post about evals and benchmarks", url: "https://blog.example/r1", body: "Text", timestamp: hoursAgo(0).toISOString(), score: 9 }),
    ]);
    const doc = buildBrief(ctx(), options({ panelIds: ["blog-panel"] }), NOW);
    const item = doc.items[0]!;
    // base = recency 1.0*0.4 = 0.4; blended = 0.5*0.9 + 0.5*0.4 = 0.65
    expect(item.score).toBe(65);
    expect(item.llm_score).toBe(9);
    expect(item.why_ranked[0]).toBe("llm-rank 9/10");
  });

  test("keyword-score and cluster annotations become reasons", () => {
    replacePanelItems("hot-panel", [
      makeContentItemRow({
        id: "k1",
        panel_id: "hot-panel",
        title: "New benchmark for open weights",
        url: "https://news.example/k1",
        body: "[Bench/Weights] 12 points | by a | 3 comments\n---\n[keyword-score: 18] benchmark, open.weights",
        applied_transforms: JSON.stringify(["keyword-score", "cluster"]),
        timestamp: hoursAgo(1).toISOString(),
      }),
    ]);
    const doc = buildBrief(ctx(), options({ panelIds: ["hot-panel"] }), NOW);
    expect(doc.items[0]!.why_ranked).toEqual([
      "12 points, 3 comments",
      "keyword-score 18 (benchmark, open.weights)",
      "clustered with related stories: Bench/Weights",
      "published 1h ago",
    ]);
  });

  test("selection is round-robin across panels within per_panel and limit", () => {
    saveItems("hn-panel", Array.from({ length: 6 }, (_, i) => hn(`h${i}`, `Hacker news story number ${i} about models`, 500 - i, 10, 1 + i)));
    saveItems("blog-panel", Array.from({ length: 2 }, (_, i) => makeContentItem({ id: `b${i}`, title: `Blog post number ${i} about models`, url: `https://blog.example/${i}`, timestamp: hoursAgo(30 + i) })));

    const doc = buildBrief(ctx(), options({ panelIds: ["hn-panel", "blog-panel"], limit: 4 }), NOW);
    expect(doc.items.map((i) => i.id)).toEqual(["h0", "h1", "b0", "b1"]);
    expect(doc.counts.cut_by_limits).toBe(4);

    const capped = buildBrief(ctx(), options({ panelIds: ["hn-panel", "blog-panel"], perPanel: 1 }), NOW);
    expect(capped.items.map((i) => i.id)).toEqual(["h0", "b0"]);
    expect(capped.items.map((i) => i.n)).toEqual([1, 2]);
  });

  test("one source cannot fill a panel while other sources wait", () => {
    const release = (id: string, source: string, h: number) =>
      makeContentItem({ id, title: `${source} release ${id} with notes`, url: `https://gh.example/${id}`, source, timestamp: hoursAgo(h) });
    saveItems("blog-panel", [
      release("a1", "github:a/a", 1),
      release("a2", "github:a/a", 2),
      release("a3", "github:a/a", 3),
      release("a4", "github:a/a", 4),
      release("b1", "github:b/b", 20),
    ]);
    const doc = buildBrief(ctx(), options({ panelIds: ["blog-panel"], perPanel: 4 }), NOW);
    expect(doc.items.map((i) => i.id)).toEqual(["a1", "a2", "a3", "b1"]);
  });
});

describe("brief summary", () => {
  test("keeps prose and drops engagement, author, discussion and annotations", () => {
    const parsed = parseBriefBody("42 points | by alice | A tool that <b>does</b> things. | 7 comments | discuss: https://d.example/1\n---\n[keyword-score: 5] tool");
    expect(parsed.summary).toBe("A tool that does things.");
    expect(parsed.engagement).toEqual({ points: 42, comments: 7 });
    expect(parsed.discussionUrl).toBe("https://d.example/1");
    expect(parsed.keywordScore).toEqual({ score: 5, terms: "tool" });
  });

  test("arXiv bodies keep only the abstract", () => {
    const parsed = parseBriefBody("Authors: A, B | Categories: cs.AI, cs.LG | Abstract: We study things | carefully.");
    expect(parsed.summary).toBe("We study things | carefully.");
  });

  test("release notes lose link-only lists and bold labels", () => {
    const body = "<details open>\r\n\r\nfix: faster kernels (#1)\r\n\r\n</details>\r\n\r\n**Website:**\r\n- <https://x.app>\r\n\r\n**Linux:**\r\n- [Ubuntu x64](https://dl/x) - [libs](https://dl/y)\r\n";
    expect(parseBriefBody(body).summary).toBe("fix: faster kernels (#1)");
  });

  test("metadata-only bodies give a null summary, stored LLM summaries win", () => {
    expect(parseBriefBody("9 points | by bob | c/localllama | 2 comments").summary).toBeNull();
    expect(parseBriefBody(null).summary).toBeNull();
    replacePanelItems("blog-panel", [
      makeContentItemRow({ id: "s1", panel_id: "blog-panel", title: "Post with an LLM summary here", url: "https://blog.example/s1", body: "Long body", summary: "  The LLM\nsummary.  ", timestamp: hoursAgo(1).toISOString() }),
    ]);
    const doc = buildBrief(ctx(), options({ panelIds: ["blog-panel"] }), NOW);
    expect(doc.items[0]!.summary).toBe("The LLM summary.");
  });

  test("summaries are capped at 280 characters on a word boundary", () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
    const summary = parseBriefBody(long).summary!;
    expect(summary.length).toBeLessThanOrEqual(BRIEF_SUMMARY_MAX_CHARS);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).toMatch(/word\d+…$/);
    expect(capBriefText("short")).toBe("short");
  });
});

describe("brief markdown", () => {
  test("renders a header, per-panel sections in layout order, and [n] items without HTML", () => {
    saveItems("hn-panel", [hn("m1", "Model <T> launches with vec<u8> support", 200, 40, 2)]);
    saveItems("blog-panel", [
      makeContentItem({ id: "m2", title: "Blog post about a model launch", url: "https://blog.example/m2", body: "<p>Details on the <em>launch</em>.</p>", timestamp: hoursAgo(5) }),
      makeContentItem({ id: "m3", title: "Old post about something else", url: "https://blog.example/m3", timestamp: hoursAgo(200) }),
    ]);
    const c = ctx();
    const md = renderBriefMarkdown(buildBrief(c, options(), NOW), c);

    expect(md.startsWith("# Pace brief: preset:test\n")).toBe(true);
    expect(md).toContain("Generated 2026-01-15T12:00:00Z. Window: items from the last 72h (since 2026-01-12T12:00:00Z).");
    expect(md).toMatch(/2 items from 4 panels; \d+ candidates, \d+ older than the window, \d+ duplicates merged, 0 cut by limits\. About \d+ tokens\./);
    expect(md).toContain("Skipped reference panels: Links.");
    expect(md).toContain("Schema pace.brief/v1.");
    expect(md.indexOf("## Hacker News")).toBeLessThan(md.indexOf("## Blog"));
    expect(md).toContain("- [1] Model \\<T> launches with vec\\<u8> support");
    expect(md).toContain("  https://news.example/m1 · hackernews:top · 2h ago · score ");
    expect(md).toContain("  why: 200 points, 40 comments; also in Everything");
    expect(md).toContain("  discussion: https://news.ycombinator.com/item?id=m1");
    expect(md).toContain("- [2] Blog post about a model launch");
    expect(md).toContain("  Details on the launch.");
    expect(md).toContain("## Hot\n\nNothing new here (no stored items yet).");
    expect(md).toMatch(/## Everything\n\nNothing new here \(2 listed under other panels, 1 older than the window\)\./);
    // Escaped "\<" is literal text; nothing else may look like a tag.
    expect(md.replace(/\\</g, "")).not.toMatch(/<\/?[a-z][^>]*>/i);
  });
});
