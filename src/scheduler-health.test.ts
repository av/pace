import { describe, test, expect } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import {
  getTestRefreshHealth,
  installSchedulerRuntimeHooks,
  refreshTestSources,
  startTestScheduler,
} from "./test/scheduler-test-harness";
import { spyConsole } from "./test/console-spy";
import { makeContentItem } from "./test/content-items";
import type { Adapter } from "./adapters/types";
import type { SourcePanelMap } from "./scheduler";
import { testAppConfig } from "./test/app-config";
import { waitForAsync } from "./test/async";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("until: condition not met in time");
    await waitForAsync(5);
  }
}

function panelMapFor(names: string[]): SourcePanelMap {
  return {
    sourceToPanels: new Map(names.map((name) => [name, [name]])),
    sourceToReadKey: new Map(),
  };
}

describe("scheduler refresh health", () => {
  installTempDbHooks({ prefix: "pace-scheduler-health-" });
  installSchedulerRuntimeHooks();

  test("source is pending before its first run completes, ok after", async () => {
    const gate = deferred();
    const adapters = new Map<string, Adapter>([
      [
        "slow",
        {
          name: "slow",
          fetch: async () => {
            await gate.promise;
            return [makeContentItem({ id: "s1", source: "slow" })];
          },
        },
      ],
    ]);
    const config = testAppConfig({
      adapters: [{ type: "slow", name: "slow", refresh_interval: 60 }],
    });

    await spyConsole(["log", "warn"], async () => {
      startTestScheduler(config, adapters, panelMapFor(["slow"]));

      const before = getTestRefreshHealth();
      expect(before.status).toBe("ok");
      expect(before.sources).toEqual([
        { kind: "adapter", name: "slow", status: "pending" },
      ]);

      gate.resolve();
      await until(() => getTestRefreshHealth().sources[0]?.status === "ok");

      const after = getTestRefreshHealth();
      expect(after.status).toBe("ok");
      const source = after.sources[0]!;
      expect(source.status).toBe("ok");
      expect(source.lastError).toBeUndefined();
      expect(typeof source.lastSuccessAt).toBe("string");
      // Completed runs report duration and item count.
      expect(Number.isInteger(source.lastDurationMs)).toBe(true);
      expect(source.lastDurationMs!).toBeGreaterThanOrEqual(0);
      expect(source.lastItemCount).toBe(1);
    });
  });

  test("failing source reports failing + lastError and degrades overall status", async () => {
    let shouldFail = false;
    const adapters = new Map<string, Adapter>([
      [
        "flaky",
        {
          name: "flaky",
          fetch: async () => {
            if (shouldFail) throw new Error("HTTP 503 from upstream");
            return [makeContentItem({ id: "f1", source: "flaky" })];
          },
        },
      ],
    ]);
    const config = testAppConfig({
      adapters: [{ type: "flaky", name: "flaky", refresh_interval: 60 }],
    });

    await spyConsole(["log", "warn"], async () => {
      startTestScheduler(config, adapters, panelMapFor(["flaky"]));
      await until(() => getTestRefreshHealth().sources[0]?.status === "ok");

      shouldFail = true;
      await refreshTestSources(["flaky"]);

      const health = getTestRefreshHealth();
      expect(health.status).toBe("degraded");
      const source = health.sources[0]!;
      expect(source.status).toBe("failing");
      expect(source.lastError).toBe("HTTP 503 from upstream");
      expect(typeof source.lastFailureAt).toBe("string");
      // The earlier success timestamp is retained for context.
      expect(typeof source.lastSuccessAt).toBe("string");
      // Duration reflects the latest (failed) run; item count is retained
      // from the last SUCCESSFUL run for context.
      expect(Number.isInteger(source.lastDurationMs)).toBe(true);
      expect(source.lastItemCount).toBe(1);
    });
  });

  test("recovery clears lastError: health reflects the latest run, not the last failure ever", async () => {
    let shouldFail = true;
    const adapters = new Map<string, Adapter>([
      [
        "flaky",
        {
          name: "flaky",
          fetch: async () => {
            if (shouldFail) throw new Error("boom");
            return [makeContentItem({ id: "f2", source: "flaky" })];
          },
        },
      ],
    ]);
    const config = testAppConfig({
      adapters: [{ type: "flaky", name: "flaky", refresh_interval: 60 }],
    });

    await spyConsole(["log", "warn"], async () => {
      startTestScheduler(config, adapters, panelMapFor(["flaky"]));
      await until(() => getTestRefreshHealth().sources[0]?.status === "failing");

      shouldFail = false;
      await refreshTestSources(["flaky"]);

      const health = getTestRefreshHealth();
      expect(health.status).toBe("ok");
      const source = health.sources[0]!;
      expect(source.status).toBe("ok");
      expect(source.lastError).toBeUndefined();
      expect(typeof source.lastSuccessAt).toBe("string");
      // Failure timestamp is kept as history alongside the recovery.
      expect(typeof source.lastFailureAt).toBe("string");
    });
  });

  test("pipelines appear in health with kind pipeline (pending until their delayed first run)", async () => {
    const adapters = new Map<string, Adapter>([
      [
        "hn",
        { name: "hn", fetch: async () => [makeContentItem({ id: "h1", source: "hn" })] },
      ],
    ]);
    const config = testAppConfig({
      adapters: [{ type: "hn", name: "hn", refresh_interval: 60 }],
      pipelines: [
        { name: "curated", sources: ["hn"], transforms: [{ type: "latest", count: 5 }] },
      ],
    });
    const panelMap: SourcePanelMap = {
      sourceToPanels: new Map([
        ["hn", ["hn-panel"]],
        ["curated", ["curated-panel"]],
      ]),
      sourceToReadKey: new Map([["hn", "hn-panel"]]),
    };

    await spyConsole(["log", "warn"], async () => {
      startTestScheduler(config, adapters, panelMap);

      // Pipelines have a delayed initial run, so right after start it is pending.
      const health = getTestRefreshHealth();
      const pipeline = health.sources.find((source) => source.kind === "pipeline");
      expect(pipeline).toEqual({ kind: "pipeline", name: "curated", status: "pending" });
      // Pending never degrades overall status.
      expect(health.status).toBe("ok");

      // An explicit refresh completes the pipeline run and flips it to ok.
      await refreshTestSources(["curated"]);
      const refreshed = getTestRefreshHealth();
      const done = refreshed.sources.find((source) => source.kind === "pipeline")!;
      expect(done.status).toBe("ok");
      // Pipeline item count = gathered input items (one hn item).
      expect(done.lastItemCount).toBe(1);
      expect(Number.isInteger(done.lastDurationMs)).toBe(true);
    });
  });
});
