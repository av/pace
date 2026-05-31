import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Adapter } from "./adapters/types";
import { initDb, closeDb, getAllItemsByPanel } from "./db";
import {
  startScheduler,
  stopScheduler,
  refreshSources,
  type SourcePanelMap,
} from "./scheduler";
import type { AppConfig } from "./config";

let tempDir: string;
let dbPath: string;
let origEnv: string | undefined;

function makeMockAdapter(items: any[] = []): Adapter {
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

const basePanelMap: SourcePanelMap = {
  sourceToPanels: new Map([["testsrc", ["panel1"]]]),
  sourceToReadKey: new Map(),
};

const baseConfig: Partial<AppConfig> = {
  adapters: [{ type: "test", name: "testsrc", refresh_interval: 60 }],
  llm: undefined,
};

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
    const config: any = { adapters: [], llm: undefined };
    const adapters = new Map<string, Adapter>();
    const pm: SourcePanelMap = { sourceToPanels: new Map(), sourceToReadKey: new Map() };
    startScheduler(config, adapters, pm, null);
    const results = await refreshSources([]);
    expect(results).toEqual([]);
  });

  test("startScheduler duplicate guard prevents re-registration (early return, no double logs)", () => {
    const items = [{ id: "i1", title: "t", url: "u", source: "s", timestamp: new Date() }];
    const adapters = new Map<string, Adapter>([["test", makeMockAdapter(items)]]);
    const logSpy = spyOn(console, "log");
    try {
      startScheduler(baseConfig as any, adapters, basePanelMap, null);
      startScheduler(baseConfig as any, adapters, basePanelMap, null); // guard
      // only one "every" log + one fetch log
      const everyLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes("every 60m"));
      expect(everyLogs.length).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("startScheduler throws on missing adapter type with exact prefix", () => {
    const config: any = { adapters: [{ type: "missing", refresh_interval: 1 }], llm: undefined };
    const adapters = new Map<string, Adapter>();
    const pm: SourcePanelMap = { sourceToPanels: new Map(), sourceToReadKey: new Map() };
    expect(() => startScheduler(config, adapters, pm, null)).toThrow(
      'scheduler: adapter type "missing" is configured but no matching adapter module was discovered'
    );
  });

  test("startScheduler with adapter fetches, saves to DB, logs success (no transforms)", async () => {
    const items = [
      { id: "g1", title: "GitHub Release", url: "https://ex", source: "gh", timestamp: new Date() },
    ];
    const adapters = new Map<string, Adapter>([["test", makeMockAdapter(items)]]);
    const logSpy = spyOn(console, "log");
    try {
      startScheduler(baseConfig as any, adapters, basePanelMap, null);
      await waitForAsync();
      const saved = getAllItemsByPanel("panel1");
      expect(saved.length).toBe(1);
      expect(saved[0].title).toBe("GitHub Release");
      const fetchedLog = logSpy.mock.calls.some((c) =>
        String(c[0]).includes("fetched 1 items")
      );
      expect(fetchedLog).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("run via refreshSources on error adapter returns failed result + warns with prefix", async () => {
    const adapters = new Map<string, Adapter>([["err", makeErrorAdapter("simulated fail")]]);
    const config: any = { adapters: [{ type: "err", name: "errsrc", refresh_interval: 60 }], llm: undefined };
    const pm: SourcePanelMap = {
      sourceToPanels: new Map([["errsrc", ["ep1"]]]),
      sourceToReadKey: new Map(),
    };
    const warnSpy = spyOn(console, "warn");
    try {
      startScheduler(config, adapters, pm, null);
      await waitForAsync();
      const results = await refreshSources(["errsrc"]);
      expect(results.length).toBe(1);
      expect(results[0].status).toBe("failed");
      expect(results[0].error).toContain("simulated fail");
      const warned = warnSpy.mock.calls.some((c) =>
        String(c[0]).includes("scheduler: errsrc — error:")
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("stopScheduler clears timers and allows restart", () => {
    const adapters = new Map<string, Adapter>([["test", makeMockAdapter([])]]);
    const logSpy = spyOn(console, "log");
    try {
      startScheduler(baseConfig as any, adapters, basePanelMap, null);
      stopScheduler();
      // restart should log "every" again
      startScheduler(baseConfig as any, adapters, basePanelMap, null);
      const everyLogs = logSpy.mock.calls.filter((c) => String(c[0]).includes("every 60m"));
      expect(everyLogs.length).toBe(2);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("refreshSources with unknown names returns no results (no crash)", async () => {
    const adapters = new Map<string, Adapter>([["test", makeMockAdapter([])]]);
    startScheduler(baseConfig as any, adapters, basePanelMap, null);
    const results = await refreshSources(["nonexistent"]);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  test("startScheduler schedules pipelines with 5s initial delay (PIPELINE_INITIAL_DELAY_MS) before first runPipelineJob + setInterval, adapters do immediate fetch; default 15m (min 1) when refresh_interval omitted (t3i)", async () => {
    const adapters = new Map<string, Adapter>([["test", makeMockAdapter([])]]);
    const config: any = {
      adapters: [{ type: "test", name: "testsrc" /* omit refresh_interval -> default 15 per t3i */ }],
      pipelines: [{
        name: "p1",
        sources: ["testsrc"],
        transforms: [],
        refresh_interval: 1,
      }],
      llm: undefined,
    };
    const pm: SourcePanelMap = {
      sourceToPanels: new Map([["testsrc", ["panelP"]]]),
      sourceToReadKey: new Map([["testsrc", "testsrc"]]),
    };
    const setTimeoutSpy = spyOn(globalThis, "setTimeout");
    const setIntervalSpy = spyOn(globalThis, "setInterval");
    const logSpy = spyOn(console, "log");
    try {
      startScheduler(config, adapters, pm, null);
      // dynamic import for the assertable hook (will be undefined -> fail until const added to scheduler.ts)
      const schedulerMod: any = await import("./scheduler");
      expect(schedulerMod.PIPELINE_INITIAL_DELAY_MS).toBe(5000);
      // exactly one setTimeout during start: the 5s for pipeline initial (adapters immediate, no timeout for their first)
      expect(setTimeoutSpy.mock.calls.length).toBe(1);
      expect(setTimeoutSpy.mock.calls[0][1]).toBe(5000);
      // setInterval for adapter (15m) + prune daily (24h); pipeline's interval set later inside timeout cb
      expect(setIntervalSpy.mock.calls.length).toBe(2);
      // default 15m log for adapter (omitted refresh_interval)
      const hasDefault15Log = logSpy.mock.calls.some((c) =>
        String(c[0]).includes("every 15m")
      );
      expect(hasDefault15Log).toBe(true);
      // pipeline setup log immediate (delay is for first *run*, not the schedule log)
      const hasPipelineEveryLog = logSpy.mock.calls.some((c) =>
        String(c[0]).includes('pipeline "p1" — every 1m')
      );
      expect(hasPipelineEveryLog).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
      setIntervalSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
