import { describe, test, expect, spyOn } from "bun:test";
import { spyConsole, spyMockCallsContaining } from "./test/console-spy";
import { sourcePanelMapFromConfig } from "./test/panel-map";
import { installTempDbHooks } from "./test/temp-db";
import {
  installSchedulerRuntimeHooks,
  startTestScheduler,
} from "./test/scheduler-test-harness";
import { adaptersMap, makeMockAdapter } from "./test/adapter-mocks";
import * as dbMod from "./db";
import { pruneOldItems, saveItems, getRawItemsByPanel } from "./db";
import { validateParsedConfig } from "./config-validate";
import { DEFAULT_LAYOUT } from "./config/domain";
import { DEFAULT_RETENTION_DAYS } from "./scheduler-runtime";
import { singlePanelLayout, testAppConfig } from "./test/app-config";
import { makeContentItem } from "./test/content-items";

describe("config: server.retention_days validation", () => {
  const base = { adapters: [], layout: DEFAULT_LAYOUT };

  test("accepts a positive integer and 0 (disable)", () => {
    expect(validateParsedConfig({ ...base, server: { retention_days: 7 } }, DEFAULT_LAYOUT).server)
      .toEqual({ retention_days: 7 });
    expect(validateParsedConfig({ ...base, server: { retention_days: 0 } }, DEFAULT_LAYOUT).server)
      .toEqual({ retention_days: 0 });
  });

  test("rejects negative, fractional, and non-number values", () => {
    for (const bad of [-1, 1.5, "30", true, null]) {
      expect(() =>
        validateParsedConfig({ ...base, server: { retention_days: bad } }, DEFAULT_LAYOUT),
      ).toThrow(/server\.retention_days must be a non-negative integer/);
    }
  });

  test("retention_days is an allowed server key alongside base_path", () => {
    const { server } = validateParsedConfig(
      { ...base, server: { base_path: "/pace", retention_days: 90 } },
      DEFAULT_LAYOUT,
    );
    expect(server).toEqual({ base_path: "/pace", retention_days: 90 });
  });
});

describe("db: pruneOldItems guard", () => {
  installTempDbHooks({ prefix: "pace-retention-db-test-" });

  test("rejects zero, negative, and non-finite day counts", () => {
    for (const bad of [0, -5, Number.NaN, Infinity, -Infinity]) {
      expect(() => pruneOldItems(bad)).toThrow(/days must be a positive finite number/);
    }
  });

  test("negative days fails loudly instead of silently pruning nothing", () => {
    saveItems("ret-p1", [makeContentItem({ id: "fresh-1" })]);
    // Old code built the invalid modifier "--5 days" -> datetime() NULL ->
    // DELETE matched nothing: retention silently stopped working. Now throws
    // (and the scheduler's prune wrapper surfaces it as a warning).
    expect(() => pruneOldItems(-5)).toThrow();
    expect(getRawItemsByPanel("ret-p1")).toHaveLength(1);
  });

  test("composite (id, panel_id) copies prune independently per panel", () => {
    const db = dbMod.getDb();
    // Same item id saved to two panels -> two rows under the composite PK.
    saveItems("ret-pa", [makeContentItem({ id: "shared-1" })]);
    saveItems("ret-pb", [makeContentItem({ id: "shared-1" })]);
    // Only panel A's copy is stale.
    db.prepare(
      "UPDATE content_items SET fetched_at = datetime('now', '-10 days') WHERE id = ? AND panel_id = ?",
    ).run("shared-1", "ret-pa");
    expect(pruneOldItems(7)).toBe(1);
    expect(getRawItemsByPanel("ret-pa")).toHaveLength(0);
    expect(getRawItemsByPanel("ret-pb").map((r) => r.id)).toEqual(["shared-1"]);
  });

  test("valid days still prunes aged rows only", () => {
    const db = dbMod.getDb();
    saveItems("ret-p2", [makeContentItem({ id: "old-1" }), makeContentItem({ id: "new-1" })]);
    db.prepare("UPDATE content_items SET fetched_at = datetime('now', '-10 days') WHERE id = ?").run("old-1");
    expect(pruneOldItems(7)).toBe(1);
    expect(getRawItemsByPanel("ret-p2").map((r) => r.id)).toEqual(["new-1"]);
  });
});

describe("scheduler: retention wiring", () => {
  installTempDbHooks({ prefix: "pace-retention-sched-test-" });
  installSchedulerRuntimeHooks();

  const config = (retentionDays?: number) =>
    testAppConfig(
      {
        adapters: [{ type: "test", name: "retsrc", refresh_interval: 60 }],
        ...(retentionDays !== undefined ? { server: { retention_days: retentionDays } } : {}),
      },
      singlePanelLayout("p1", "retsrc", { id: "panel1", limit: 50 }),
    );

  test("startScheduler prunes with configured retention_days", async () => {
    const pruneSpy = spyOn(dbMod, "pruneOldItems").mockReturnValue(0);
    try {
      const cfg = config(7);
      await spyConsole(["log"], () => {
        startTestScheduler(cfg, adaptersMap(["test", makeMockAdapter([])]), sourcePanelMapFromConfig(cfg), null);
      });
      expect(pruneSpy).toHaveBeenCalledWith(7);
    } finally {
      pruneSpy.mockRestore();
    }
  });

  test("startScheduler defaults to DEFAULT_RETENTION_DAYS when unset", async () => {
    const pruneSpy = spyOn(dbMod, "pruneOldItems").mockReturnValue(0);
    try {
      const cfg = config();
      await spyConsole(["log"], () => {
        startTestScheduler(cfg, adaptersMap(["test", makeMockAdapter([])]), sourcePanelMapFromConfig(cfg), null);
      });
      expect(pruneSpy).toHaveBeenCalledWith(DEFAULT_RETENTION_DAYS);
      expect(DEFAULT_RETENTION_DAYS).toBe(30);
    } finally {
      pruneSpy.mockRestore();
    }
  });

  test("retention_days: 0 disables pruning entirely and logs it", async () => {
    const pruneSpy = spyOn(dbMod, "pruneOldItems").mockReturnValue(0);
    try {
      const cfg = config(0);
      await spyConsole(["log"], ({ log: logSpy }) => {
        startTestScheduler(cfg, adaptersMap(["test", makeMockAdapter([])]), sourcePanelMapFromConfig(cfg), null);
        expect(spyMockCallsContaining(logSpy, "pruning disabled")).toHaveLength(1);
      });
      expect(pruneSpy).not.toHaveBeenCalled();
    } finally {
      pruneSpy.mockRestore();
    }
  });
});
