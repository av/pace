import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { spyConsole } from "./test/console-spy";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Adapter, ContentItem } from "./adapters/types";
import * as dbMod from "./db";
import { initDb, closeDb, getAllItemsByPanel, saveItems } from "./db";
import * as utilsMod from "./utils";
import {
  startScheduler,
  stopScheduler,
  refreshSources,
  allPanelRefreshSourceNames,
  PIPELINE_INITIAL_DELAY_MS,
  DEFAULT_REFRESH_INTERVAL_MIN,
  type SourcePanelMap,
} from "./scheduler";
import type { AppConfig } from "./config";

let tempDir: string;
let dbPath: string;
let origEnv: string | undefined;

function schedulerConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    adapters: [],
    layout: { direction: "row", children: [{ panel: "all", source: "all", limit: 50 }] },
    ...overrides,
  };
}

function makeMockAdapter(items: ContentItem[] = []): Adapter {
  return {
    name: "mock",
    fetch: async () => items,
  };
}

function makeErrorAdapter(msg = "boom"): Adapter {
  return {
    name: "err",
    fetch: async () => {
      throw new Error(msg);
    },
  };
}

async function waitForAsync(ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function emptyPanelMap(): SourcePanelMap {
  return { sourceToPanels: new Map(), sourceToReadKey: new Map() };
}

function panelMap(
  panels: Record<string, string[]>,
  readKeys: Record<string, string> = {}
): SourcePanelMap {
  return {
    sourceToPanels: new Map(Object.entries(panels)),
    sourceToReadKey: new Map(Object.entries(readKeys)),
  };
}

function adaptersMap(...entries: [string, Adapter][]): Map<string, Adapter> {
  return new Map(entries);
}

const basePanelMap = panelMap({ testsrc: ["panel1"] });

const baseConfig = schedulerConfig({
  adapters: [{ type: "test", name: "testsrc", refresh_interval: 60 }],
});

describe("scheduler", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pace-scheduler-test-"));
    dbPath = join(tempDir, "test.db");
    origEnv = process.env.PACE_DB_PATH;
    process.env.PACE_DB_PATH = dbPath;
    stopScheduler();
    closeDb();
    initDb();
  });

  afterEach(() => {
    stopScheduler();
    closeDb();
    if (origEnv !== undefined) {
      process.env.PACE_DB_PATH = origEnv;
    } else {
      delete process.env.PACE_DB_PATH;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("startScheduler with no adapters/pipelines is safe and refreshSources returns empty", async () => {
    const config = schedulerConfig({ adapters: [] });
    const adapters = new Map<string, Adapter>();
    startScheduler(config, adapters, emptyPanelMap(), null);
    const results = await refreshSources([]);
    expect(results).toEqual([]);
  });

  test("startScheduler duplicate guard prevents re-registration (early return, no double logs)", async () => {
    const items = [{ id: "i1", title: "t", url: "u", source: "s", timestamp: new Date() }];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    await spyConsole(["log"], ({ log: logSpy }) => {
      startScheduler(baseConfig, adapters, basePanelMap, null);
      startScheduler(baseConfig, adapters, basePanelMap, null); // guard
      const everyLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes("every 60m"));
      expect(everyLogs.length).toBe(1);
    });
  });

  test("startScheduler throws on missing adapter type with exact prefix", () => {
    const config = schedulerConfig({ adapters: [{ type: "missing", refresh_interval: 1 }] });
    const adapters = new Map<string, Adapter>();
    expect(() => startScheduler(config, adapters, emptyPanelMap(), null)).toThrow(
      'scheduler: adapter type "missing" is configured but no matching adapter module was discovered'
    );
  });

  test("startScheduler throws on multiple missing adapter types with plural message", () => {
    const config = schedulerConfig({
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
      { id: "g1", title: "GitHub Release", url: "https://ex", source: "gh", timestamp: new Date() },
    ];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    await spyConsole(["log"], async ({ log: logSpy }) => {
      startScheduler(baseConfig, adapters, basePanelMap, null);
      await waitForAsync();
      const saved = getAllItemsByPanel("panel1");
      expect(saved.length).toBe(1);
      expect(saved[0].title).toBe("GitHub Release");
      const fetchedLog = logSpy.mock.calls.some((c) =>
        String(c[0]).includes("fetched 1 items")
      );
      expect(fetchedLog).toBe(true);
    });
  });

  test("run via refreshSources on error adapter returns failed result + warns with prefix", async () => {
    const adapters = adaptersMap(["err", makeErrorAdapter("simulated fail")]);
    const config = schedulerConfig({ adapters: [{ type: "err", name: "errsrc", refresh_interval: 60 }] });
    const pm = panelMap({ errsrc: ["ep1"] });
    await spyConsole(["warn"], async ({ warn: warnSpy }) => {
      startScheduler(config, adapters, pm, null);
      await waitForAsync();
      const results = await refreshSources(["errsrc"]);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe("failed");
      expect(results[0].error).toContain("simulated fail");
      const warned = warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("scheduler: failed to refresh errsrc:")
      );
      expect(warned).toBe(true);
    });
  });

  test("prune failure on startScheduler warns with errorMessage", async () => {
    const pruneSpy = spyOn(dbMod, "pruneOldItems").mockImplementation(() => {
      throw new Error("db prune fail");
    });
    const emSpy = spyOn(utilsMod, "errorMessage");
    try {
      await spyConsole(["warn"], ({ warn: warnSpy }) => {
        const adapters = adaptersMap(["test", makeMockAdapter([])]);
        startScheduler(baseConfig, adapters, basePanelMap, null);
        expect(pruneSpy).toHaveBeenCalledWith(30);
        expect(emSpy).toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith("scheduler: failed to prune: db prune fail");
      });
    } finally {
      pruneSpy.mockRestore();
      emSpy.mockRestore();
    }
  });

  test("stopScheduler clears timers and allows restart", async () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    await spyConsole(["log"], ({ log: logSpy }) => {
      startScheduler(baseConfig, adapters, basePanelMap, null);
      stopScheduler();
      startScheduler(baseConfig, adapters, basePanelMap, null);
      const everyLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes("every 60m"));
      expect(everyLogs.length).toBe(2);
    });
  });

  test("allPanelRefreshSourceNames includes adapters and pipelines for source: all refresh", () => {
    expect(
      allPanelRefreshSourceNames(["hn", "rss"], [{ name: "firehose" }, { name: "curated" }]),
    ).toEqual(["hn", "rss", "firehose", "curated"]);
    expect(allPanelRefreshSourceNames(["only"], undefined)).toEqual(["only"]);
  });

  test("refreshSources with adapter + pipeline names refreshes both (all-panel contract)", async () => {
    const items = [{ id: "a1", title: "A", url: "https://a", source: "srcA", timestamp: new Date() }];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    const config = schedulerConfig({
      adapters: [{ type: "test", name: "srcA", refresh_interval: 60 }],
      pipelines: [{
        name: "merge",
        sources: ["srcA"],
        transforms: [{ type: "latest", count: 5 }],
      }],
    });
    const pm = panelMap({ srcA: ["panelA"], merge: ["outPanel"] }, { srcA: "panelA" });
    startScheduler(config, adapters, pm, null);
    await waitForAsync();
    const names = allPanelRefreshSourceNames(["srcA"], config.pipelines);
    const results = await refreshSources(names);
    const kinds = new Set(results.map((r) => `${r.kind}:${r.name}`));
    expect(kinds.has("adapter:srcA")).toBe(true);
    expect(kinds.has("pipeline:merge")).toBe(true);
    expect(getAllItemsByPanel("outPanel").length).toBeGreaterThan(0);
  });

  test("refreshSources with unknown names returns no results (no crash)", async () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    startScheduler(baseConfig, adapters, basePanelMap, null);
    const results = await refreshSources(["nonexistent"]);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  test("runPipelineJob preserves source concat order when timestamps tie (stable sort)", async () => {
    const ts = "2024-06-01T12:00:00.000Z";
    saveItems("srcA", [
      { id: "a1", title: "A first", url: "https://a/1", source: "srcA", timestamp: new Date(ts) },
      { id: "a2", title: "A second", url: "https://a/2", source: "srcA", timestamp: new Date(ts) },
    ]);
    saveItems("srcB", [
      { id: "b1", title: "B first", url: "https://b/1", source: "srcB", timestamp: new Date(ts) },
    ]);
    const config = schedulerConfig({
      adapters: [],
      pipelines: [{
        name: "merge",
        sources: ["srcA", "srcB"],
        transforms: [{ type: "latest", count: 10 }],
      }],
    });
    const pm = panelMap({ merge: ["outPanel"] }, { srcA: "srcA", srcB: "srcB" });
    startScheduler(config, new Map(), pm, null);
    await refreshSources(["merge"]);
    const out = getAllItemsByPanel("outPanel");
    expect(out.map((r) => r.id)).toEqual([
      "pipeline:merge:a1",
      "pipeline:merge:a2",
      "pipeline:merge:b1",
    ]);
  });

  test("startScheduler schedules pipelines with 5s initial delay (PIPELINE_INITIAL_DELAY_MS) before first runPipelineJob + setInterval, adapters do immediate fetch; default refresh when refresh_interval omitted (t3i)", async () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    const config = schedulerConfig({
      adapters: [{ type: "test", name: "testsrc" /* omit refresh_interval -> DEFAULT_REFRESH_INTERVAL_MIN */ }],
      pipelines: [{
        name: "p1",
        sources: ["testsrc"],
        transforms: [],
        refresh_interval: 1,
      }],
    });
    const pm = panelMap({ testsrc: ["panelP"] }, { testsrc: "testsrc" });
    const setTimeoutSpy = spyOn(globalThis, "setTimeout");
    const setIntervalSpy = spyOn(globalThis, "setInterval");
    try {
      await spyConsole(["log"], ({ log: logSpy }) => {
        startScheduler(config, adapters, pm, null);
        expect(PIPELINE_INITIAL_DELAY_MS).toBe(5000);
        expect(setTimeoutSpy.mock.calls.length).toBe(1);
        expect(setTimeoutSpy.mock.calls[0][1]).toBe(5000);
        expect(setIntervalSpy.mock.calls.length).toBe(2);
        const hasDefaultRefreshLog = logSpy.mock.calls.some((c) =>
          String(c[0]).includes(`every ${DEFAULT_REFRESH_INTERVAL_MIN}m`)
        );
        expect(hasDefaultRefreshLog).toBe(true);
        const hasPipelineEveryLog = logSpy.mock.calls.some((c) =>
          String(c[0]).includes('pipeline "p1" — every 1m')
        );
        expect(hasPipelineEveryLog).toBe(true);
      });
    } finally {
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
    }
  });
});
