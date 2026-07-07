import { describe, test, expect, spyOn } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import {
  installSchedulerRuntimeHooks,
  refreshTestSources,
  startTestScheduler,
} from "./test/scheduler-test-harness";
import { spyConsole } from "./test/console-spy";
import { makeContentItem } from "./test/content-items";
import type { Adapter, ContentItem } from "./adapters/types";
import type { SourcePanelMap } from "./scheduler";
import { testAppConfig } from "./test/app-config";
import { waitForAsync } from "./test/async";
import * as transformsMod from "./transforms";
import * as dbMod from "./db";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function liveAdapter(name: string, items: ContentItem[]): Adapter {
  return { name, fetch: async () => [...items] };
}

describe("scheduler refresh concurrency", () => {
  installTempDbHooks({ prefix: "pace-scheduler-concurrency-" });
  installSchedulerRuntimeHooks();

  test("concurrent refresh of a source sharing a panel is not wiped by a stale transform replace", async () => {
    const slowItems = [makeContentItem({ id: "a1", source: "slow" })];
    const fastItems = [makeContentItem({ id: "b1", source: "fast" })];

    const adapters = new Map<string, Adapter>([
      ["slow", liveAdapter("slow", slowItems)],
      ["fast", liveAdapter("fast", fastItems)],
    ]);

    const config = testAppConfig({
      adapters: [
        {
          type: "slow",
          name: "slow",
          refresh_interval: 60,
          transforms: [{ type: "sort", field: "timestamp" }],
        },
        { type: "fast", name: "fast", refresh_interval: 60 },
      ],
    });

    // Both sources feed the same panel.
    const panelMap: SourcePanelMap = {
      sourceToPanels: new Map([
        ["slow", ["shared"]],
        ["fast", ["shared"]],
      ]),
      sourceToReadKey: new Map(),
    };

    const gate = deferred();
    let block = false;
    const realRunPipeline = transformsMod.runPipeline;
    const rpSpy = spyOn(transformsMod, "runPipeline").mockImplementation(
      async (items, pipeline, ctx) => {
        if (block) await gate.promise;
        return realRunPipeline(items, pipeline, ctx);
      },
    );

    try {
      await spyConsole(["log"], async () => {
        startTestScheduler(config, adapters, panelMap, null);
        await waitForAsync();
        expect(dbMod.getAllItemsByPanel("shared").map((r) => r.id).sort()).toEqual(["a1", "b1"]);

        // Start a slow refresh whose transform stalls mid-flight with a
        // snapshot of the panel taken before the await.
        block = true;
        const slowRefresh = refreshTestSources(["slow"]);
        await waitForAsync();

        // While the slow transform is in flight, "fast" fetches a new item.
        fastItems.push(makeContentItem({ id: "b2", source: "fast" }));
        const fastRefresh = refreshTestSources(["fast"]);
        await waitForAsync();

        gate.resolve();
        const [slowResults, fastResults] = await Promise.all([slowRefresh, fastRefresh]);
        expect(slowResults[0].status).toBe("ok");
        expect(fastResults[0].status).toBe("ok");

        // Without per-panel locking, the slow refresh's replacePanelItems
        // rewrites the panel from its stale snapshot and b2 is lost.
        const ids = dbMod.getAllItemsByPanel("shared").map((r) => r.id).sort();
        expect(ids).toEqual(["a1", "b1", "b2"]);
      });
    } finally {
      block = false;
      gate.resolve();
      rpSpy.mockRestore();
    }
  });
});
