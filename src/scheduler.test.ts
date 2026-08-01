import { describe, test, expect, spyOn } from "bun:test";
import * as piAi from "@mariozechner/pi-ai";
import { spyConsole, spyMockCallsContaining } from "./test/console-spy";
import { emptyPanelMap, sourcePanelMapFromConfig } from "./test/panel-map";
import { installTempDbHooks } from "./test/temp-db";
import {
  installSchedulerRuntimeHooks,
  refreshTestSources,
  startTestScheduler,
  stopTestScheduler,
} from "./test/scheduler-test-harness";
import type { Adapter } from "./adapters/types";
import { makeContentItem, makeContentItemRow } from "./test/content-items";
import { adaptersMap, makeErrorAdapter, makeMockAdapter } from "./test/adapter-mocks";
import { withErrorMessageSpy } from "./test/error-message-spy";
import * as dbMod from "./db";
import { PIPELINE_INITIAL_DELAY_MS, DEFAULT_REFRESH_INTERVAL_MIN } from "./scheduler";
import { allPanelRefreshSourceNames, resolvePanelRefreshSourceNames } from "./layout/types";
import {
  adapterAndPipelinePanelsLayout,
  adapterPipelineLayout,
  singlePanelLayout,
  testAppConfig,
} from "./test/app-config";
import { waitForAsync } from "./test/async";

const fakeLlmModel = { id: "fake" } as piAi.Model<piAi.Api>;

const baseConfig = testAppConfig(
  { adapters: [{ type: "test", name: "testsrc", refresh_interval: 60 }] },
  singlePanelLayout("p1", "testsrc", { id: "panel1", limit: 50 }),
);
const basePanelMap = sourcePanelMapFromConfig(baseConfig);

describe("scheduler", () => {
  installTempDbHooks({ prefix: "pace-scheduler-test-" });
  installSchedulerRuntimeHooks();

  test("startScheduler with no adapters/pipelines is safe and refreshSources returns empty", async () => {
    const config = testAppConfig({ adapters: [] });
    const adapters = new Map<string, Adapter>();
    startTestScheduler(config, adapters, emptyPanelMap(), null);
    const results = await refreshTestSources([]);
    expect(results).toEqual([]);
  });

  test("startScheduler duplicate guard prevents re-registration (early return, no double logs)", async () => {
    const items = [makeContentItem({ id: "i1", title: "t", url: "u", source: "s" })];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    await spyConsole(["log"], ({ log: logSpy }) => {
      startTestScheduler(baseConfig, adapters, basePanelMap, null);
      startTestScheduler(baseConfig, adapters, basePanelMap, null); // guard
      expect(spyMockCallsContaining(logSpy, "every 60m")).toHaveLength(1);
    });
  });

  test("startScheduler throws on missing adapter type with exact prefix", () => {
    const config = testAppConfig({ adapters: [{ type: "missing", refresh_interval: 1 }] });
    const adapters = new Map<string, Adapter>();
    expect(() => startTestScheduler(config, adapters, emptyPanelMap(), null)).toThrow(
      'scheduler: adapter type "missing" is configured but no matching adapter module was discovered'
    );
  });

  test("startScheduler throws on multiple missing adapter types with plural message", () => {
    const config = testAppConfig({
      adapters: [
        { type: "missing-a", refresh_interval: 1 },
        { type: "missing-b", refresh_interval: 1 },
      ],
    });
    const adapters = new Map<string, Adapter>();
    expect(() => startTestScheduler(config, adapters, emptyPanelMap(), null)).toThrow(
      'scheduler: adapter types "missing-a", "missing-b" are configured but no matching adapter modules were discovered'
    );
  });

  test("startScheduler with adapter fetches, saves to DB, logs success (no transforms)", async () => {
    const items = [
      makeContentItem({ id: "g1", title: "GitHub Release", url: "https://ex", source: "gh" }),
    ];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    await spyConsole(["log"], async ({ log: logSpy }) => {
      startTestScheduler(baseConfig, adapters, basePanelMap, null);
      await waitForAsync();
      const saved = dbMod.getAllItemsByPanel("panel1");
      expect(saved.length).toBe(1);
      expect(saved[0].title).toBe("GitHub Release");
      expect(logSpy).toHaveBeenCalledWith("scheduler: testsrc - fetched 1 items");
    });
  });

  test("run via refreshSources on error adapter returns failed result + warns with prefix", async () => {
    const adapters = adaptersMap(["err", makeErrorAdapter("simulated fail")]);
    const config = testAppConfig(
      { adapters: [{ type: "err", name: "errsrc", refresh_interval: 60 }] },
      singlePanelLayout("ep", "errsrc", { id: "ep1" }),
    );
    const pm = sourcePanelMapFromConfig(config);
    await spyConsole(["warn"], async ({ warn: warnSpy }) => {
      startTestScheduler(config, adapters, pm, null);
      await waitForAsync();
      const results = await refreshTestSources(["errsrc"]);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe("failed");
      expect(results[0].error).toContain("simulated fail");
      expect(warnSpy).toHaveBeenCalledWith(
        "scheduler: failed to refresh errsrc: simulated fail",
      );
    });
  });

  test("prune failure on startScheduler warns with errorMessage", async () => {
    const pruneSpy = spyOn(dbMod, "pruneOldItems").mockImplementation(() => {
      throw new Error("db prune fail");
    });
    try {
      await withErrorMessageSpy(async (emSpy) => {
        await spyConsole(["warn"], ({ warn: warnSpy }) => {
          const adapters = adaptersMap(["test", makeMockAdapter([])]);
          startTestScheduler(baseConfig, adapters, basePanelMap, null);
          expect(pruneSpy).toHaveBeenCalledWith(30);
          expect(emSpy).toHaveBeenCalled();
          expect(warnSpy).toHaveBeenCalledWith("scheduler: failed to prune: db prune fail");
        });
      });
    } finally {
      pruneSpy.mockRestore();
    }
  });

  test("stopScheduler clears timers and allows restart", async () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    await spyConsole(["log"], ({ log: logSpy }) => {
      startTestScheduler(baseConfig, adapters, basePanelMap, null);
      stopTestScheduler();
      startTestScheduler(baseConfig, adapters, basePanelMap, null);
      expect(spyMockCallsContaining(logSpy, "every 60m")).toHaveLength(2);
    });
  });

  test("allPanelRefreshSourceNames includes adapters and pipelines for source: all refresh", () => {
    expect(
      allPanelRefreshSourceNames(["hn", "rss"], [{ name: "firehose" }, { name: "curated" }]),
    ).toEqual(["hn", "rss", "firehose", "curated"]);
    expect(allPanelRefreshSourceNames(["only"], undefined)).toEqual(["only"]);
  });

  test("resolvePanelRefreshSourceNames expands all and dedupes mixed panel sources", () => {
    const pipelines = [{ name: "curated" }];
    expect(
      resolvePanelRefreshSourceNames([{ adapter: "all" }], ["hn", "rss"], pipelines),
    ).toEqual(["hn", "rss", "curated"]);
    expect(
      resolvePanelRefreshSourceNames(
        [{ adapter: "rss" }, { adapter: "podcast" }],
        ["hn"],
        pipelines,
      ),
    ).toEqual(["rss", "podcast"]);
    expect(
      resolvePanelRefreshSourceNames(
        [{ adapter: "rss" }, { adapter: "rss" }],
        ["hn"],
        pipelines,
      ),
    ).toEqual(["rss"]);
  });

  test("refreshSources with adapter + pipeline names refreshes both (all-panel contract)", async () => {
    const items = [makeContentItem({ id: "a1", title: "A", url: "https://a", source: "srcA" })];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    const config = testAppConfig(
      {
        adapters: [{ type: "test", name: "srcA", refresh_interval: 60 }],
        pipelines: [{
          name: "merge",
          sources: ["srcA"],
          transforms: [{ type: "latest", count: 5 }],
        }],
      },
      adapterPipelineLayout("srcA", "merge"),
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();
    const names = allPanelRefreshSourceNames(["srcA"], config.pipelines);
    const results = await refreshTestSources(names);
    const kinds = new Set(results.map((r) => `${r.kind}:${r.name}`));
    expect(kinds.has("adapter:srcA")).toBe(true);
    expect(kinds.has("pipeline:merge")).toBe(true);
    expect(dbMod.getAllItemsByPanel("outPanel")).toHaveLength(1); // 1 adapter item through latest-5 pipeline
  });

  test("refreshSources with unknown names returns no results (no crash)", async () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    startTestScheduler(baseConfig, adapters, basePanelMap, null);
    const results = await refreshTestSources(["nonexistent"]);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  test("adapter ingest transforms apply via shared transform path", async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      makeContentItem({
        id: `i${i}`,
        title: `T${i}`,
        url: `https://x/${i}`,
        source: "src",
        timestamp: new Date(`2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
      }),
    );
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    const config = testAppConfig(
      {
        adapters: [{
          type: "test",
          name: "src",
          refresh_interval: 60,
          transforms: [{ type: "latest", count: 3 }],
        }],
      },
      singlePanelLayout("a", "src", { id: "panelA" }),
    );
    const pm = sourcePanelMapFromConfig(config);
    await spyConsole(["log"], async ({ log: logSpy }) => {
      startTestScheduler(config, adapters, pm, null);
      await waitForAsync();
      expect(dbMod.getAllItemsByPanel("panelA").length).toBe(3);
      expect(logSpy).toHaveBeenCalledWith("scheduler: src - transforms: 10 -> 3 items");
    });
  });

  test("runPipelineJob reads source items via layout sourceToReadKey panel mapping", async () => {
    dbMod.saveItems("hn-panel", [
      makeContentItem({
        id: "h1",
        title: "HN item",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ]);
    const config = testAppConfig(
      {
        adapters: [],
        pipelines: [{
          name: "curated",
          sources: ["hn"],
          transforms: [{ type: "latest", count: 10 }],
        }],
      },
      {
        direction: "column",
        panels: [
          { panel: "tech", source: "hn", id: "hn-panel" },
          { panel: "pipe", source: "curated", id: "out" },
        ],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, new Map(), pm, null);
    await refreshTestSources(["curated"]);
    const out = dbMod.getAllItemsByPanel("out");
    expect(out.map((r) => r.id)).toEqual(["pipeline:curated:h1"]);
  });

  test("gatherPipelineInputItems reads a shared read-key panel once when two pipeline sources map to it (no duplicate input rows)", async () => {
    // Both adapters feed one shared panel, so both sources resolve to the
    // same read key. Reading it once per source doubled every row, which a
    // count-limited transform then filled with duplicates of the newest item,
    // crowding out real ones (h1 twice instead of h1 + r1).
    dbMod.saveItems("shared", [
      makeContentItem({
        id: "h1",
        title: "HN item",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-02T12:00:00.000Z"),
      }),
      makeContentItem({
        id: "r1",
        title: "RSS item",
        url: "https://rss/1",
        source: "rss",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ]);
    const config = testAppConfig(
      {
        adapters: [],
        pipelines: [{
          name: "curated",
          sources: ["hn", "rss"],
          transforms: [{ type: "latest", count: 2 }],
        }],
      },
      {
        direction: "column",
        panels: [
          { panel: "mixed", source: ["hn", "rss"], id: "shared" },
          { panel: "pipe", source: "curated", id: "out" },
        ],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, new Map(), pm, null);
    await refreshTestSources(["curated"]);
    const out = dbMod.getAllItemsByPanel("out").map((r) => r.id).sort();
    expect(out).toEqual(["pipeline:curated:h1", "pipeline:curated:r1"]);
  });

  test("gatherPipelineInputItems dedupes same-id copies living on two different read-key panels", async () => {
    // Composite (id, panel_id) storage: one adapter feeding two panels keeps
    // a per-panel copy of each item. A pipeline sourcing two adapters whose
    // read keys are those panels saw both copies; with a count-limited
    // transform the duplicate crowded out a real item (x1 twice, r1 dropped).
    const shared = makeContentItem({
      id: "x1",
      title: "Shared item",
      url: "https://x/1",
      source: "hn",
      timestamp: new Date("2024-06-02T12:00:00.000Z"),
    });
    dbMod.saveItems("panelA", [shared]);
    dbMod.saveItems("panelB", [
      shared,
      makeContentItem({
        id: "r1",
        title: "RSS item",
        url: "https://rss/1",
        source: "rss",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ]);
    const config = testAppConfig(
      {
        adapters: [],
        pipelines: [{
          name: "curated",
          sources: ["hn", "rss"],
          transforms: [{ type: "latest", count: 2 }],
        }],
      },
      {
        direction: "column",
        panels: [
          { panel: "a", source: "hn", id: "panelA" },
          { panel: "b", source: "rss", id: "panelB" },
          { panel: "pipe", source: "curated", id: "out" },
        ],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, new Map(), pm, null);
    await refreshTestSources(["curated"]);
    const out = dbMod.getAllItemsByPanel("out").map((r) => r.id).sort();
    expect(out).toEqual(["pipeline:curated:r1", "pipeline:curated:x1"]);
  });

  test("runPipelineJob does not re-transform its own output when it shares a panel with its source (no pipeline:x:pipeline:x id growth)", async () => {
    // Panel lists both the adapter and the pipeline consuming it, so the
    // adapter's read key is the shared panel and the pipeline's previous
    // output is visible to gatherPipelineInputItems.
    dbMod.saveItems("shared", [
      makeContentItem({
        id: "h1",
        title: "HN item",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ]);
    const config = testAppConfig(
      {
        adapters: [],
        pipelines: [{
          name: "curated",
          sources: ["hn"],
          transforms: [{ type: "latest", count: 10 }],
        }],
      },
      {
        direction: "column",
        panels: [
          { panel: "mixed", source: ["hn", "curated"], id: "shared" },
        ],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, new Map(), pm, null);
    const rawPanelIds = () =>
      (dbMod.getDb()
        .prepare("SELECT id FROM content_items WHERE panel_id = ? ORDER BY id")
        .all("shared") as { id: string }[])
        .map((r) => r.id);
    await refreshTestSources(["curated"]);
    // Raw adapter item survives the pipeline's replace on the shared panel.
    expect(rawPanelIds()).toEqual(["h1", "pipeline:curated:h1"]);
    // Subsequent refreshes must not treat the previous output as fresh input:
    // no pipeline:curated:pipeline:curated:... id growth, no item loss.
    await refreshTestSources(["curated"]);
    await refreshTestSources(["curated"]);
    expect(rawPanelIds()).toEqual(["h1", "pipeline:curated:h1"]);
  });

  test("runPipelineJob reuses previous-cycle llm-summarize summaries (input rows re-read from raw source panels)", async () => {
    // Pipeline input is gathered from SOURCE panels (raw rows, no summaries)
    // while last cycle's summaries live on the OUTPUT panel under rewritten
    // pipeline:<name>:<id> ids, so llm-summarize's "skip rows with a summary"
    // cache never hit: every cycle re-summarized every item.
    const summarizedIdBatches: string[][] = [];
    const completeSpy = spyOn(piAi, "complete").mockImplementation(async (_model, context) => {
      const userContent = context.messages
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n");
      const ids = [...userContent.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
      summarizedIdBatches.push(ids);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(ids.map((id) => ({ id, summary: `Summary of ${id}.` }))),
        }],
      } as Awaited<ReturnType<typeof piAi.complete>>;
    });
    try {
      dbMod.saveItems("hn-panel", [
        makeContentItem({
          id: "h1",
          title: "HN item",
          url: "https://hn/1",
          source: "hn",
          timestamp: new Date("2024-06-01T12:00:00.000Z"),
        }),
      ]);
      const config = testAppConfig(
        {
          adapters: [],
          pipelines: [{
            name: "curated",
            sources: ["hn"],
            transforms: [{ type: "llm-summarize" }],
          }],
        },
        {
          direction: "column",
          panels: [
            { panel: "tech", source: "hn", id: "hn-panel" },
            { panel: "pipe", source: "curated", id: "out" },
          ],
        },
      );
      const pm = sourcePanelMapFromConfig(config);
      startTestScheduler(config, new Map(), pm, fakeLlmModel);

      await refreshTestSources(["curated"]);
      expect(summarizedIdBatches).toEqual([["h1"]]);
      expect(dbMod.getAllItemsByPanel("out").map((r) => [r.id, r.summary])).toEqual([
        ["pipeline:curated:h1", "Summary of h1."],
      ]);

      // Second cycle re-reads the raw source panel (still no summaries there):
      // the previous output's summary must be reused, not recomputed.
      await refreshTestSources(["curated"]);
      expect(summarizedIdBatches).toEqual([["h1"]]);
      expect(dbMod.getAllItemsByPanel("out").map((r) => [r.id, r.summary])).toEqual([
        ["pipeline:curated:h1", "Summary of h1."],
      ]);

      // A new source item is the only one summarized on the next cycle.
      dbMod.saveItems("hn-panel", [
        makeContentItem({
          id: "h2",
          title: "Newer HN item",
          url: "https://hn/2",
          source: "hn",
          timestamp: new Date("2024-06-02T12:00:00.000Z"),
        }),
      ]);
      await refreshTestSources(["curated"]);
      expect(summarizedIdBatches).toEqual([["h1"], ["h2"]]);
      const out = dbMod.getAllItemsByPanel("out")
        .map((r) => [r.id, r.summary])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      expect(out).toEqual([
        ["pipeline:curated:h1", "Summary of h1."],
        ["pipeline:curated:h2", "Summary of h2."],
      ]);
    } finally {
      completeSpy.mockRestore();
    }
  });

  test("runPipelineJob summary reuse keeps a fresher input summary over the cached output one", async () => {
    // A source row that already carries a summary (e.g. adapter-level
    // llm-summarize on the source panel) must win over the stale cached copy
    // on the pipeline output panel. saveItems never persists summaries
    // (adapters do not produce them), so seed both panels via replace.
    dbMod.replacePanelItems("hn-panel", [
      makeContentItemRow({
        id: "h1",
        panel_id: "hn-panel",
        title: "HN item",
        url: "https://hn/1",
        source: "hn",
        summary: "Fresh input summary.",
        timestamp: "2024-06-01T12:00:00.000Z",
      }),
    ]);
    dbMod.replacePanelItems("out", [
      makeContentItemRow({
        id: "pipeline:curated:h1",
        panel_id: "out",
        title: "HN item",
        url: "https://hn/1",
        source: "hn",
        summary: "Stale cached summary.",
        timestamp: "2024-06-01T12:00:00.000Z",
      }),
    ]);
    const config = testAppConfig(
      {
        adapters: [],
        pipelines: [{
          name: "curated",
          sources: ["hn"],
          transforms: [{ type: "llm-summarize" }],
        }],
      },
      {
        direction: "column",
        panels: [
          { panel: "tech", source: "hn", id: "hn-panel" },
          { panel: "pipe", source: "curated", id: "out" },
        ],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, new Map(), pm, fakeLlmModel);
    await refreshTestSources(["curated"]);
    expect(dbMod.getAllItemsByPanel("out").map((r) => [r.id, r.summary])).toEqual([
      ["pipeline:curated:h1", "Fresh input summary."],
    ]);
  });

  test("runPipelineJob reuses previous-cycle llm-rank scores and only scores new items", async () => {
    // Same shape as the llm-summarize cache bug: pipeline input comes from raw
    // SOURCE panels (score null) while last cycle's scores live on the OUTPUT
    // panel under pipeline:<name>:<id> ids, so llm-rank re-scored every item
    // every cycle. Scores are absolute per-item relevance, so reuse is safe.
    const rankedIdBatches: string[][] = [];
    const scoreById: Record<string, number> = { h1: 4, h2: 9 };
    const completeSpy = spyOn(piAi, "complete").mockImplementation(async (_model, context) => {
      const userContent = context.messages
        .map((m) => (typeof m.content === "string" ? m.content : ""))
        .join("\n");
      const ids = [...userContent.matchAll(/id: "([^"]+)"/g)].map((m) => m[1]);
      rankedIdBatches.push(ids);
      return {
        content: [{
          type: "text",
          text: JSON.stringify(ids.map((id) => ({ id, score: scoreById[id] ?? 0 }))),
        }],
      } as Awaited<ReturnType<typeof piAi.complete>>;
    });
    try {
      dbMod.saveItems("hn-panel", [
        makeContentItem({
          id: "h1",
          title: "HN item",
          url: "https://hn/1",
          source: "hn",
          timestamp: new Date("2024-06-01T12:00:00.000Z"),
        }),
      ]);
      const config = testAppConfig(
        {
          adapters: [],
          pipelines: [{
            name: "curated",
            sources: ["hn"],
            transforms: [{ type: "llm-rank", interests: ["tech"] }],
          }],
        },
        {
          direction: "column",
          panels: [
            { panel: "tech", source: "hn", id: "hn-panel" },
            { panel: "pipe", source: "curated", id: "out" },
          ],
        },
      );
      const pm = sourcePanelMapFromConfig(config);
      startTestScheduler(config, new Map(), pm, fakeLlmModel);

      await refreshTestSources(["curated"]);
      expect(rankedIdBatches).toEqual([["h1"]]);
      expect(dbMod.getAllItemsByPanel("out").map((r) => [r.id, r.score])).toEqual([
        ["pipeline:curated:h1", 4],
      ]);

      // Second cycle re-reads the raw source panel (score null there): the
      // previous output's score must be reused with zero LLM calls.
      await refreshTestSources(["curated"]);
      expect(rankedIdBatches).toEqual([["h1"]]);
      expect(dbMod.getAllItemsByPanel("out").map((r) => [r.id, r.score])).toEqual([
        ["pipeline:curated:h1", 4],
      ]);

      // A new source item is the only one scored on the next cycle, and the
      // output order reflects the combined cached + fresh scores.
      dbMod.saveItems("hn-panel", [
        makeContentItem({
          id: "h2",
          title: "Newer HN item",
          url: "https://hn/2",
          source: "hn",
          timestamp: new Date("2024-06-02T12:00:00.000Z"),
        }),
      ]);
      await refreshTestSources(["curated"]);
      expect(rankedIdBatches).toEqual([["h1"], ["h2"]]);
      const out = dbMod.getAllItemsByPanel("out")
        .map((r) => [r.id, r.score])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      expect(out).toEqual([
        ["pipeline:curated:h1", 4],
        ["pipeline:curated:h2", 9],
      ]);
    } finally {
      completeSpy.mockRestore();
    }
  });

  test("runPipelineJob score reuse keeps a fresher input score over the cached output one", async () => {
    // A source row that already carries a score (e.g. adapter-level llm-rank
    // on the source panel, persisted via replacePanelItems) must win over the
    // stale cached copy on the pipeline output panel — and with every row
    // scored, the cycle must make no LLM calls at all.
    const completeSpy = spyOn(piAi, "complete").mockImplementation(async () => {
      throw new Error("must not be called");
    });
    try {
      dbMod.replacePanelItems("hn-panel", [
        makeContentItemRow({
          id: "h1",
          panel_id: "hn-panel",
          title: "HN item",
          url: "https://hn/1",
          source: "hn",
          score: 8.5,
          timestamp: "2024-06-01T12:00:00.000Z",
        }),
      ]);
      dbMod.replacePanelItems("out", [
        makeContentItemRow({
          id: "pipeline:curated:h1",
          panel_id: "out",
          title: "HN item",
          url: "https://hn/1",
          source: "hn",
          score: 2,
          timestamp: "2024-06-01T12:00:00.000Z",
        }),
      ]);
      const config = testAppConfig(
        {
          adapters: [],
          pipelines: [{
            name: "curated",
            sources: ["hn"],
            transforms: [{ type: "llm-rank", interests: ["tech"] }],
          }],
        },
        {
          direction: "column",
          panels: [
            { panel: "tech", source: "hn", id: "hn-panel" },
            { panel: "pipe", source: "curated", id: "out" },
          ],
        },
      );
      const pm = sourcePanelMapFromConfig(config);
      startTestScheduler(config, new Map(), pm, fakeLlmModel);
      await refreshTestSources(["curated"]);
      expect(completeSpy).not.toHaveBeenCalled();
      expect(dbMod.getAllItemsByPanel("out").map((r) => [r.id, r.score])).toEqual([
        ["pipeline:curated:h1", 8.5],
      ]);
    } finally {
      completeSpy.mockRestore();
    }
  });

  test("two pipelines sourcing the same adapter on one shared panel keep each other's output and never cross-prefix ids", async () => {
    // Shared panel lists the adapter plus BOTH pipelines consuming it, so
    // each pipeline's input read (adapter read key = shared panel) sees the
    // other pipeline's output. That output must be excluded from input
    // (no pipeline:a:pipeline:b:... growth) and must survive the replace.
    dbMod.saveItems("shared", [
      makeContentItem({
        id: "h1",
        title: "HN item",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ]);
    const config = testAppConfig(
      {
        adapters: [],
        pipelines: [
          { name: "a", sources: ["hn"], transforms: [{ type: "latest", count: 10 }] },
          { name: "b", sources: ["hn"], transforms: [{ type: "latest", count: 10 }] },
        ],
      },
      {
        direction: "column",
        panels: [
          { panel: "mixed", source: ["hn", "a", "b"], id: "shared" },
        ],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, new Map(), pm, null);
    const rawPanelIds = () =>
      (dbMod.getDb()
        .prepare("SELECT id FROM content_items WHERE panel_id = ? ORDER BY id")
        .all("shared") as { id: string }[])
        .map((r) => r.id);
    await refreshTestSources(["a", "b"]);
    expect(rawPanelIds()).toEqual(["h1", "pipeline:a:h1", "pipeline:b:h1"]);
    // Repeat refreshes stay stable: no cross-prefixing, no clobbered output.
    await refreshTestSources(["a", "b"]);
    await refreshTestSources(["b", "a"]);
    expect(rawPanelIds()).toEqual(["h1", "pipeline:a:h1", "pipeline:b:h1"]);
    // Read layer dedupes by url; the enriched pipeline copy wins the tie.
    const deduped = dbMod.getAllItemsByPanel("shared");
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id.startsWith("pipeline:")).toBe(true);
  });

  test("adapter with ingest transforms sharing a panel with a pipeline keeps the pipeline's output across adapter refreshes", async () => {
    // Adapter-level transforms rewrite their panels. On a panel shared with a
    // pipeline consuming the adapter, the transforms must neither consume the
    // pipeline's output as input nor wipe it in the replace. An explicit
    // refreshSources(["hn"]) would mask a wipe (dependent pipelines re-run and
    // regenerate their output), so this exercises the adapter-only path: the
    // adapter's initial run at scheduler start, with pipeline output pre-seeded
    // (pipelines have a 5s initial delay and do not run here).
    dbMod.saveItems("shared", [
      makeContentItem({
        id: "pipeline:curated:h1",
        title: "HN item (curated)",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ]);
    const items = [
      makeContentItem({
        id: "h1",
        title: "HN item",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    const config = testAppConfig(
      {
        adapters: [{
          type: "test",
          name: "hn",
          refresh_interval: 60,
          transforms: [{ type: "latest", count: 10 }],
        }],
        pipelines: [{
          name: "curated",
          sources: ["hn"],
          transforms: [{ type: "latest", count: 10 }],
        }],
      },
      {
        direction: "column",
        panels: [
          { panel: "mixed", source: ["hn", "curated"], id: "shared" },
        ],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();
    const rawPanelIds = () =>
      (dbMod.getDb()
        .prepare("SELECT id FROM content_items WHERE panel_id = ? ORDER BY id")
        .all("shared") as { id: string }[])
        .map((r) => r.id);
    // Adapter's initial run has fetched h1 and applied its transforms; the
    // pre-seeded pipeline output must survive that rewrite.
    expect(rawPanelIds()).toEqual(["h1", "pipeline:curated:h1"]);
    // Full refresh cycles stay stable: no duplication, no re-prefixing.
    await refreshTestSources(["curated"]);
    await refreshTestSources(["hn"]);
    expect(rawPanelIds()).toEqual(["h1", "pipeline:curated:h1"]);
  });

  test("adapter ingest transforms on a panel shared with another adapter keep the co-tenant's items", async () => {
    // Regression: adapter-level transforms used to read EVERY non-pipeline row
    // on the panel, so `latest count:1` on one source fed the co-tenant
    // adapter's rows through the transform and the replace physically deleted
    // whatever the transform dropped - wiping the other adapter's items on
    // every refresh cycle. Transforms must be scoped to the rows the
    // transforming source owns.
    const hnItems = [
      makeContentItem({
        id: "hn:1",
        title: "HN new",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-04T12:00:00.000Z"),
      }),
      makeContentItem({
        id: "hn:2",
        title: "HN old",
        url: "https://hn/2",
        source: "hn",
        timestamp: new Date("2024-06-03T12:00:00.000Z"),
      }),
    ];
    const blogItems = [
      makeContentItem({
        id: "blog:1",
        title: "Blog post 1",
        url: "https://blog/1",
        source: "blog",
        timestamp: new Date("2024-06-02T12:00:00.000Z"),
      }),
      makeContentItem({
        id: "blog:2",
        title: "Blog post 2",
        url: "https://blog/2",
        source: "blog",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ];
    const adapters = adaptersMap(
      ["blogtest", makeMockAdapter(blogItems)],
      ["hntest", makeMockAdapter(hnItems)],
    );
    const config = testAppConfig(
      {
        adapters: [
          { type: "blogtest", name: "blog", refresh_interval: 60 },
          {
            type: "hntest",
            name: "hn",
            refresh_interval: 60,
            transforms: [{ type: "latest", count: 1 }],
          },
        ],
      },
      {
        direction: "row",
        panels: [{ panel: "mixed", source: ["blog", "hn"], id: "shared" }],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();
    const rawPanelIds = () =>
      dbMod.getRawItemsByPanel("shared").map((r) => r.id).sort();
    // hn's `latest count:1` trimmed hn's own rows to the newest one; blog's
    // rows are untouched co-tenants.
    expect(rawPanelIds()).toEqual(["blog:1", "blog:2", "hn:1"]);
    // Rows carry their owning source for the per-source transform scoping.
    const owners = new Map(dbMod.getRawItemsByPanel("shared").map((r) => [r.id, r.owner_source]));
    expect(owners.get("blog:1")).toBe("blog");
    expect(owners.get("hn:1")).toBe("hn");
    // Repeated refresh cycles of the transforming source stay stable: the
    // co-tenant's rows must survive every cycle, not just the first.
    await refreshTestSources(["hn"]);
    await refreshTestSources(["hn"]);
    expect(rawPanelIds()).toEqual(["blog:1", "blog:2", "hn:1"]);
    // And refreshing the co-tenant does not disturb hn's transformed rows.
    await refreshTestSources(["blog"]);
    expect(rawPanelIds()).toEqual(["blog:1", "blog:2", "hn:1"]);
  });

  test("dashboard snapshot cache invalidates across a shared-panel transform refresh and keeps co-tenant rows", async () => {
    // Interaction lock between the snapshot cache (db.ts) and per-source
    // transform scoping (scheduler-runtime.ts): a refresh of one co-tenant
    // rewrites the shared panel via replacePanelItems, which MUST bump the
    // write stamp so cached snapshots are recomputed — and the recomputed
    // snapshot must still contain the other adapter's rows.
    const blogItems = [
      makeContentItem({
        id: "blog:1",
        title: "Blog post 1",
        url: "https://blog/1",
        source: "blog",
        timestamp: new Date("2024-06-02T12:00:00.000Z"),
      }),
    ];
    const hnItems = [
      makeContentItem({
        id: "hn:1",
        title: "HN new",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-04T12:00:00.000Z"),
      }),
      makeContentItem({
        id: "hn:2",
        title: "HN old",
        url: "https://hn/2",
        source: "hn",
        timestamp: new Date("2024-06-03T12:00:00.000Z"),
      }),
    ];
    const adapters = adaptersMap(
      ["blogtest", makeMockAdapter(blogItems)],
      ["hntest", makeMockAdapter(hnItems)],
    );
    const config = testAppConfig(
      {
        adapters: [
          { type: "blogtest", name: "blog", refresh_interval: 60 },
          {
            type: "hntest",
            name: "hn",
            refresh_interval: 60,
            transforms: [{ type: "latest", count: 1 }],
          },
        ],
      },
      {
        direction: "row",
        panels: [{ panel: "mixed", source: ["blog", "hn"], id: "shared" }],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();

    const snapshotIds = (s: dbMod.DashboardPanelSnapshot) => s.items.map((i) => i.id).sort();
    const first = dbMod.loadDashboardPanelData("shared", false, 50);
    expect(snapshotIds(first)).toEqual(["blog:1", "hn:1"]);
    // No writes since: the cache serves the identical snapshot.
    expect(dbMod.loadDashboardPanelData("shared", false, 50)).toBe(first);

    // A co-tenant refresh (upsert + scoped transform replace) must invalidate
    // the cached snapshot, and the fresh one keeps blog's rows.
    await refreshTestSources(["hn"]);
    const afterHn = dbMod.loadDashboardPanelData("shared", false, 50);
    expect(afterHn).not.toBe(first);
    expect(snapshotIds(afterHn)).toEqual(["blog:1", "hn:1"]);

    // Same for the transform-less co-tenant's own refresh.
    await refreshTestSources(["blog"]);
    const afterBlog = dbMod.loadDashboardPanelData("shared", false, 50);
    expect(afterBlog).not.toBe(afterHn);
    expect(snapshotIds(afterBlog)).toEqual(["blog:1", "hn:1"]);
  });

  test("adapter ingest transforms on a shared panel retain unowned legacy rows instead of deleting them", async () => {
    // Rows saved before owner attribution existed have owner_source NULL. On
    // a shared panel they cannot be attributed, so transforms must leave them
    // alone (retained) rather than consume-and-delete them.
    dbMod.saveItems("shared", [
      makeContentItem({
        id: "legacy:1",
        title: "Pre-migration row",
        url: "https://legacy/1",
        source: "blog",
        timestamp: new Date("2024-06-01T12:00:00.000Z"),
      }),
    ]);
    const hnItems = [
      makeContentItem({
        id: "hn:1",
        title: "HN new",
        url: "https://hn/1",
        source: "hn",
        timestamp: new Date("2024-06-04T12:00:00.000Z"),
      }),
    ];
    const adapters = adaptersMap(
      ["blogtest", makeMockAdapter([])],
      ["hntest", makeMockAdapter(hnItems)],
    );
    const config = testAppConfig(
      {
        adapters: [
          { type: "blogtest", name: "blog", refresh_interval: 60 },
          {
            type: "hntest",
            name: "hn",
            refresh_interval: 60,
            transforms: [{ type: "latest", count: 1 }],
          },
        ],
      },
      {
        direction: "row",
        panels: [{ panel: "mixed", source: ["blog", "hn"], id: "shared" }],
      },
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();
    await refreshTestSources(["hn"]);
    const ids = dbMod.getRawItemsByPanel("shared").map((r) => r.id).sort();
    expect(ids).toEqual(["hn:1", "legacy:1"]);
  });

  test("adapter ingest transforms on a single-source panel still apply to all stored rows", async () => {
    // The per-source scoping is shared-panel-only: on a panel with one source,
    // stored rows without owner attribution (e.g. saved by an older version)
    // must still flow through the transforms as before.
    dbMod.saveItems("panelA", [
      makeContentItem({
        id: "old:1",
        title: "Stale stored row",
        url: "https://old/1",
        source: "src",
        timestamp: new Date("2024-01-01T00:00:00.000Z"),
      }),
    ]);
    const items = [
      makeContentItem({
        id: "new:1",
        title: "Fresh row",
        url: "https://new/1",
        source: "src",
        timestamp: new Date("2024-06-01T00:00:00.000Z"),
      }),
    ];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    const config = testAppConfig(
      {
        adapters: [{
          type: "test",
          name: "src",
          refresh_interval: 60,
          transforms: [{ type: "latest", count: 1 }],
        }],
      },
      singlePanelLayout("a", "src", { id: "panelA" }),
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, adapters, pm, null);
    await waitForAsync();
    expect(dbMod.getRawItemsByPanel("panelA").map((r) => r.id)).toEqual(["new:1"]);
  });

  test("runPipelineJob preserves source concat order when timestamps tie (stable sort)", async () => {
    const ts = "2024-06-01T12:00:00.000Z";
    dbMod.saveItems("srcA", [
      makeContentItem({ id: "a1", title: "A first", url: "https://a/1", source: "srcA", timestamp: new Date(ts) }),
      makeContentItem({ id: "a2", title: "A second", url: "https://a/2", source: "srcA", timestamp: new Date(ts) }),
    ]);
    dbMod.saveItems("srcB", [
      makeContentItem({ id: "b1", title: "B first", url: "https://b/1", source: "srcB", timestamp: new Date(ts) }),
    ]);
    const config = testAppConfig(
      {
        adapters: [],
        pipelines: [{
          name: "merge",
          sources: ["srcA", "srcB"],
          transforms: [{ type: "latest", count: 10 }],
        }],
      },
      singlePanelLayout("out", "merge", { id: "outPanel" }),
    );
    const pm = sourcePanelMapFromConfig(config);
    startTestScheduler(config, new Map(), pm, null);
    await refreshTestSources(["merge"]);
    const out = dbMod.getAllItemsByPanel("outPanel");
    expect(out.map((r) => r.id)).toEqual([
      "pipeline:merge:a1",
      "pipeline:merge:a2",
      "pipeline:merge:b1",
    ]);
  });

  test("startScheduler schedules pipelines with 5s initial delay (PIPELINE_INITIAL_DELAY_MS) before first runPipelineJob + setInterval, adapters do immediate fetch; default refresh when refresh_interval omitted (t3i)", async () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    const config = testAppConfig(
      {
        adapters: [{ type: "test", name: "testsrc" /* omit refresh_interval -> DEFAULT_REFRESH_INTERVAL_MIN */ }],
        pipelines: [{
          name: "p1",
          sources: ["testsrc"],
          transforms: [],
          refresh_interval: 1,
        }],
      },
      adapterAndPipelinePanelsLayout("testsrc", "p1"),
    );
    const pm = sourcePanelMapFromConfig(config);
    const setTimeoutSpy = spyOn(globalThis, "setTimeout");
    const setIntervalSpy = spyOn(globalThis, "setInterval");
    try {
      await spyConsole(["log"], ({ log: logSpy }) => {
        startTestScheduler(config, adapters, pm, null);
        expect(PIPELINE_INITIAL_DELAY_MS).toBe(5000);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
        expect(setIntervalSpy).toHaveBeenCalledTimes(2);
        expect(logSpy).toHaveBeenCalledWith(
          `scheduler: testsrc - every ${DEFAULT_REFRESH_INTERVAL_MIN}m`,
        );
        expect(logSpy).toHaveBeenCalledWith('scheduler: pipeline "p1" - every 1m');
      });
    } finally {
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    }
  });
});