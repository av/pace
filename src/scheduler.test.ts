import { describe, test, expect, spyOn } from "bun:test";
import { spyConsole, spyMockCallsContaining } from "./test/console-spy";
import { emptyPanelMap, sourcePanelMapFromConfig } from "./test/panel-map";
import { installTempDbHooks } from "./test/temp-db";
import type { Adapter } from "./adapters/types";
import { makeContentItem } from "./test/content-items";
import { adaptersMap, makeErrorAdapter, makeMockAdapter } from "./test/adapter-mocks";
import { withErrorMessageSpy } from "./test/error-message-spy";
import * as dbMod from "./db";
import {
  startScheduler,
  stopScheduler,
  refreshSources,
  createSchedulerState,
  PIPELINE_INITIAL_DELAY_MS,
  DEFAULT_REFRESH_INTERVAL_MIN,
} from "./scheduler";
import { allPanelRefreshSourceNames, resolvePanelRefreshSourceNames } from "./layout/types";
import {
  adapterAndPipelinePanelsLayout,
  adapterPipelineLayout,
  singlePanelLayout,
  testAppConfig,
} from "./test/app-config";
import { waitForAsync } from "./test/async";

const baseConfig = testAppConfig(
  { adapters: [{ type: "test", name: "testsrc", refresh_interval: 60 }] },
  singlePanelLayout("p1", "testsrc", { id: "panel1", limit: 50 }),
);
const basePanelMap = sourcePanelMapFromConfig(baseConfig);

describe("scheduler", () => {
  installTempDbHooks({ prefix: "pace-scheduler-test-", stopSchedulerOnTeardown: true });

  test("startScheduler with no adapters/pipelines is safe and refreshSources returns empty", async () => {
    const config = testAppConfig({ adapters: [] });
    const adapters = new Map<string, Adapter>();
    startScheduler(config, adapters, emptyPanelMap(), null);
    const results = await refreshSources([]);
    expect(results).toEqual([]);
  });

  test("startScheduler duplicate guard prevents re-registration (early return, no double logs)", async () => {
    const items = [makeContentItem({ id: "i1", title: "t", url: "u", source: "s" })];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    await spyConsole(["log"], ({ log: logSpy }) => {
      startScheduler(baseConfig, adapters, basePanelMap, null);
      startScheduler(baseConfig, adapters, basePanelMap, null); // guard
      expect(spyMockCallsContaining(logSpy, "every 60m")).toHaveLength(1);
    });
  });

  test("startScheduler throws on missing adapter type with exact prefix", () => {
    const config = testAppConfig({ adapters: [{ type: "missing", refresh_interval: 1 }] });
    const adapters = new Map<string, Adapter>();
    expect(() => startScheduler(config, adapters, emptyPanelMap(), null)).toThrow(
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
    expect(() => startScheduler(config, adapters, emptyPanelMap(), null)).toThrow(
      'scheduler: adapter types "missing-a", "missing-b" are configured but no matching adapter modules were discovered'
    );
  });

  test("startScheduler with adapter fetches, saves to DB, logs success (no transforms)", async () => {
    const items = [
      makeContentItem({ id: "g1", title: "GitHub Release", url: "https://ex", source: "gh" }),
    ];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    await spyConsole(["log"], async ({ log: logSpy }) => {
      startScheduler(baseConfig, adapters, basePanelMap, null);
      await waitForAsync();
      const saved = dbMod.getAllItemsByPanel("panel1");
      expect(saved.length).toBe(1);
      expect(saved[0].title).toBe("GitHub Release");
      expect(logSpy).toHaveBeenCalledWith("scheduler: testsrc — fetched 1 items");
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
      startScheduler(config, adapters, pm, null);
      await waitForAsync();
      const results = await refreshSources(["errsrc"]);
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
          startScheduler(baseConfig, adapters, basePanelMap, null);
          expect(pruneSpy).toHaveBeenCalledWith(30);
          expect(emSpy).toHaveBeenCalled();
          expect(warnSpy).toHaveBeenCalledWith("scheduler: failed to prune: db prune fail");
        });
      });
    } finally {
      pruneSpy.mockRestore();
    }
  });

  test("SchedulerState reset clears entries, maps, and prune timer", () => {
    const schedulerState = createSchedulerState();
    const pruneTimer = setInterval(() => {}, 60_000);
    schedulerState.adapterEntries.push({
      name: "a",
      panelIds: ["p"],
      adapterConfig: { type: "test" },
      adapter: makeMockAdapter([]),
      intervalMs: 1000,
      timer: setInterval(() => {}, 1000),
      running: false,
    });
    schedulerState.sourceToReadKey.set("src", "panel");
    schedulerState.transformCtx = { llmModel: null, llmConfig: undefined };
    schedulerState.pruneTimer = pruneTimer;

    schedulerState.reset((entry) => {
      if (entry.timer) clearInterval(entry.timer);
    });

    expect(schedulerState.isStarted()).toBe(false);
    expect(schedulerState.adapterEntries).toHaveLength(0);
    expect(schedulerState.sourceToReadKey.size).toBe(0);
    expect(schedulerState.transformCtx).toEqual({ llmModel: null });
    expect(schedulerState.pruneTimer).toBeNull();
  });

  test("stopScheduler clears timers and allows restart", async () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    await spyConsole(["log"], ({ log: logSpy }) => {
      startScheduler(baseConfig, adapters, basePanelMap, null);
      stopScheduler();
      startScheduler(baseConfig, adapters, basePanelMap, null);
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
    startScheduler(config, adapters, pm, null);
    await waitForAsync();
    const names = allPanelRefreshSourceNames(["srcA"], config.pipelines);
    const results = await refreshSources(names);
    const kinds = new Set(results.map((r) => `${r.kind}:${r.name}`));
    expect(kinds.has("adapter:srcA")).toBe(true);
    expect(kinds.has("pipeline:merge")).toBe(true);
    expect(dbMod.getAllItemsByPanel("outPanel").length).toBeGreaterThan(0);
  });

  test("refreshSources with unknown names returns no results (no crash)", async () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    startScheduler(baseConfig, adapters, basePanelMap, null);
    const results = await refreshSources(["nonexistent"]);
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
      startScheduler(config, adapters, pm, null);
      await waitForAsync();
      expect(dbMod.getAllItemsByPanel("panelA").length).toBe(3);
      expect(logSpy).toHaveBeenCalledWith("scheduler: src — transforms: 10 → 3 items");
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
    startScheduler(config, new Map(), pm, null);
    await refreshSources(["curated"]);
    const out = dbMod.getAllItemsByPanel("out");
    expect(out.map((r) => r.id)).toEqual(["pipeline:curated:h1"]);
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
    startScheduler(config, new Map(), pm, null);
    await refreshSources(["merge"]);
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
        startScheduler(config, adapters, pm, null);
        expect(PIPELINE_INITIAL_DELAY_MS).toBe(5000);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
        expect(setIntervalSpy).toHaveBeenCalledTimes(2);
        expect(logSpy).toHaveBeenCalledWith(
          `scheduler: testsrc — every ${DEFAULT_REFRESH_INTERVAL_MIN}m`,
        );
        expect(logSpy).toHaveBeenCalledWith('scheduler: pipeline "p1" — every 1m');
      });
    } finally {
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    }
  });
});
