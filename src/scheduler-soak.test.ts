/**
 * Soak-style regression tests for long-running `pace serve` (weeks under
 * Docker): drive many refresh cycles over a real temp DB and assert that
 * every piece of scheduler bookkeeping returns to its idle size — no
 * unbounded growth in the in-flight set, panel-lock key map, health entries,
 * DB rows (upsert-stable inputs), or the dashboard snapshot cache — and that
 * stopScheduler leaves nothing started.
 */
import { describe, test, expect } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import { spyConsole } from "./test/console-spy";
import { makeContentItem } from "./test/content-items";
import { waitForAsync } from "./test/async";
import { testAppConfig } from "./test/app-config";
import type { Adapter, ContentItem } from "./adapters/types";
import type { SourcePanelMap } from "./scheduler";
import { createSchedulerRuntime } from "./scheduler";
import {
  getAllItemsByPanel,
  loadDashboardPanelData,
  dashboardSnapshotCacheSize,
} from "./db";

const FIXED_TS = new Date("2026-08-01T10:00:00Z");

function fixedItems(prefix: string, count: number): ContentItem[] {
  return Array.from({ length: count }, (_, i) =>
    makeContentItem({ id: `${prefix}-${i + 1}`, source: prefix, timestamp: FIXED_TS }),
  );
}

describe("scheduler soak (long-running-process invariants)", () => {
  installTempDbHooks({ prefix: "pace-scheduler-soak-" });

  test("40 refresh cycles keep every scheduler map/set at its idle size", async () => {
    const okItems = fixedItems("okad", 3);
    const flakyItems = fixedItems("flaky", 1);
    let flakyCalls = 0;

    const adapters = new Map<string, Adapter>([
      ["okad-type", { name: "okad-type", fetch: async () => [...okItems] }],
      [
        "flaky-type",
        {
          name: "flaky-type",
          fetch: async () => {
            // Fail every other cycle so the failure-tracking fields
            // (lastError/lastFailureAt) are exercised on a live entry.
            flakyCalls++;
            if (flakyCalls % 2 === 0) throw new Error("soak: simulated outage");
            return [...flakyItems];
          },
        },
      ],
    ]);

    const config = testAppConfig({
      adapters: [
        { type: "okad-type", name: "okad", refresh_interval: 60 },
        { type: "flaky-type", name: "flaky", refresh_interval: 60 },
      ],
      pipelines: [
        {
          name: "pipe",
          sources: ["okad", "flaky"],
          transforms: [{ type: "sort", field: "timestamp" }],
          refresh_interval: 60,
        },
      ],
    });

    const panelMap: SourcePanelMap = {
      sourceToPanels: new Map([
        ["okad", ["p-ok", "shared"]],
        ["flaky", ["shared"]],
        ["pipe", ["p-out"]],
      ]),
      sourceToReadKey: new Map([
        ["okad", "p-ok"],
        ["flaky", "shared"],
      ]),
    };

    const runtime = createSchedulerRuntime();
    const { state } = runtime;

    await spyConsole(["log", "warn"], async (spies) => {
      // Silence the per-cycle scheduler chatter (40 cycles x several lines).
      spies.log.mockImplementation(() => {});
      spies.warn.mockImplementation(() => {});
      try {
        runtime.startScheduler(config, adapters, panelMap, null);
        await waitForAsync();

        const idleEntryCounts = {
          adapters: state.adapterEntries.length,
          pipelines: state.pipelineEntries.length,
        };
        let baselineRowCounts: Record<string, number> | null = null;

        for (let cycle = 1; cycle <= 40; cycle++) {
          if (cycle % 5 === 0) {
            // Overlapping waves: the second refresh hits the `running` guard
            // and the panel-lock queue while the first is mid-flight.
            await Promise.all([
              runtime.refreshSources(["okad", "flaky"]),
              runtime.refreshSources(["okad", "flaky"]),
            ]);
          } else {
            await runtime.refreshSources(["okad", "flaky"]);
          }
          // Let inFlight self-removal continuations run.
          await runtime.drainInFlight(1000);

          // Bookkeeping must be back at idle after EVERY cycle, not only at
          // the end - a slow monotonic leak would still fail here early.
          expect(state.inFlight.size).toBe(0);
          expect(state.panelLocks.pendingKeyCount()).toBe(0);
          expect(state.adapterEntries.length).toBe(idleEntryCounts.adapters);
          expect(state.pipelineEntries.length).toBe(idleEntryCounts.pipelines);
          expect(runtime.getRefreshHealth().sources.length).toBe(
            idleEntryCounts.adapters + idleEntryCounts.pipelines,
          );

          // Dashboard reads interleaved with writes: the snapshot cache must
          // stay bounded by the distinct (panel,isAll,limit) keys used.
          loadDashboardPanelData("p-ok", false, 50);
          loadDashboardPanelData("shared", false, 50);
          loadDashboardPanelData("p-out", false, 50);
          expect(dashboardSnapshotCacheSize()).toBeLessThanOrEqual(3);

          // Upsert-stable inputs: row counts must not creep across cycles.
          const rowCounts: Record<string, number> = {
            "p-ok": getAllItemsByPanel("p-ok").length,
            shared: getAllItemsByPanel("shared").length,
            "p-out": getAllItemsByPanel("p-out").length,
          };
          if (cycle === 3) {
            baselineRowCounts = rowCounts;
          } else if (baselineRowCounts) {
            expect(rowCounts).toEqual(baselineRowCounts);
          }
        }

        // The flaky source really alternated (failure paths were exercised).
        expect(flakyCalls).toBeGreaterThanOrEqual(40);
        const flakyHealth = runtime
          .getRefreshHealth()
          .sources.find((s) => s.name === "flaky");
        expect(flakyHealth?.lastFailureAt ?? flakyHealth?.lastSuccessAt).toBeDefined();
      } finally {
        runtime.stopScheduler();
      }

      // Shutdown leaves nothing started: entries cleared, prune timer gone,
      // fresh lock map, and a drain resolves immediately.
      expect(state.isStarted()).toBe(false);
      expect(state.pruneTimer).toBeNull();
      expect(state.adapterEntries.length).toBe(0);
      expect(state.pipelineEntries.length).toBe(0);
      expect(state.panelLocks.pendingKeyCount()).toBe(0);
      await runtime.drainInFlight(100);
      expect(state.inFlight.size).toBe(0);
    });
  });
});
