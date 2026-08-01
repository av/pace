import { describe, test, expect } from "bun:test";
import type { Adapter, ContentItem } from "./adapters/types";
import { createSchedulerRuntime } from "./scheduler";
import { adapterPipelineLayout, singlePanelLayout, testAppConfig } from "./test/app-config";
import { buildLayoutRuntimeMaps } from "./layout/types";
import { installTempDbHooks } from "./test/temp-db";

function gate(): { promise: Promise<ContentItem[]>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<ContentItem[]>((resolve) => {
    release = () => resolve([]);
  });
  return { promise, release };
}

function slowSetup(fetchResult: Promise<ContentItem[]>) {
  const config = testAppConfig(
    { adapters: [{ type: "slow", refresh_interval: 15 }] },
    singlePanelLayout("Slow", "slow", { id: "slow-panel" }),
  );
  const adapters = new Map<string, Adapter>([
    ["slow", { name: "slow", fetch: async () => fetchResult }],
  ]);
  const { sourceToPanels, sourceToReadKey } = buildLayoutRuntimeMaps(
    config.layout,
    ["slow"],
    config.pipelines,
  );
  return { config, adapters, panelMap: { sourceToPanels, sourceToReadKey } };
}

describe("drainInFlight", () => {
  installTempDbHooks({ prefix: "pace-drain-test-" });

  test("resolves immediately when nothing is running", async () => {
    const runtime = createSchedulerRuntime();
    await runtime.drainInFlight(5_000);
    expect(runtime.state.inFlight.size).toBe(0);
  });

  test("waits for a scheduled refresh in flight across stopScheduler", async () => {
    const fetchGate = gate();
    const { config, adapters, panelMap } = slowSetup(fetchGate.promise);
    const runtime = createSchedulerRuntime();

    // startScheduler fires the adapter's initial run, which blocks on the gate.
    runtime.startScheduler(config, adapters, panelMap);
    expect(runtime.state.inFlight.size).toBe(1);

    runtime.stopScheduler();
    // stopScheduler clears timers but must NOT forget in-flight runs.
    expect(runtime.state.inFlight.size).toBe(1);

    let drained = false;
    const drain = runtime.drainInFlight(5_000).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    fetchGate.release();
    await drain;
    expect(drained).toBe(true);
    expect(runtime.state.inFlight.size).toBe(0);
  });

  test("waits for manual refreshSources runs", async () => {
    const fetchGate = gate();
    const { config, adapters, panelMap } = slowSetup(fetchGate.promise);
    const runtime = createSchedulerRuntime();
    runtime.startScheduler(config, adapters, panelMap);
    // Let the initial scheduled run finish so only the manual one is pending.
    fetchGate.release();
    await runtime.drainInFlight(5_000);

    const secondGate = gate();
    adapters.set("slow", { name: "slow", fetch: async () => secondGate.promise });
    // Entries capture the adapter at start time, so mutate via the entry.
    runtime.state.adapterEntries[0]!.adapter = adapters.get("slow")!;

    const refresh = runtime.refreshSources(["slow"]);
    // Both the whole refresh chain and the adapter run itself are tracked.
    expect(runtime.state.inFlight.size).toBe(2);

    let drained = false;
    const drain = runtime.drainInFlight(5_000).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    secondGate.release();
    await drain;
    await refresh;
    expect(drained).toBe(true);
    runtime.stopScheduler();
  });

  test("waits for pipeline jobs registered after refreshSources' adapter phase", async () => {
    // refreshSources runs its pipeline phase only AFTER the adapter phase
    // settles, so a drain started mid-chain must not resolve while the
    // pipeline job (registered later) is still writing panels.
    const config = testAppConfig(
      {
        adapters: [{ type: "slow", name: "slow", refresh_interval: 60 }],
        pipelines: [
          { name: "pipe", sources: ["slow"], transforms: [{ type: "latest", count: 5 }] },
        ],
      },
      adapterPipelineLayout("slow", "pipe"),
    );
    const fetchGate = gate();
    const adapters = new Map<string, Adapter>([
      ["slow", { name: "slow", fetch: async () => fetchGate.promise }],
    ]);
    const { sourceToPanels, sourceToReadKey } = buildLayoutRuntimeMaps(
      config.layout,
      ["slow"],
      config.pipelines,
    );
    const runtime = createSchedulerRuntime();
    runtime.startScheduler(config, adapters, { sourceToPanels, sourceToReadKey });
    // Let the initial scheduled adapter run finish so only the manual chain
    // is in flight below (the pipeline's initial run is delayed 5s and the
    // test stops the scheduler before it fires).
    fetchGate.release();
    await runtime.drainInFlight(5_000);

    const secondGate = gate();
    runtime.state.adapterEntries[0]!.adapter = {
      name: "slow",
      fetch: async () => secondGate.promise,
    };

    // Hold the pipeline's output-panel lock so its job, once registered,
    // deterministically blocks mid-write until the test releases it.
    let releasePanelLock: () => void = () => {};
    const panelLockHeld = new Promise<void>((resolve) => {
      releasePanelLock = resolve;
    });
    const lockHolder = runtime.state.panelLocks.withLock(["outPanel"], () => panelLockHeld);

    const refresh = runtime.refreshSources(["pipe"]);

    let drained = false;
    const drain = runtime.drainInFlight(5_000).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    // Adapter phase settles; the pipeline job registers and blocks on the
    // held panel lock. The drain must keep waiting for it.
    secondGate.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(drained).toBe(false);

    releasePanelLock();
    await lockHolder;
    await refresh;
    await drain;
    expect(drained).toBe(true);
    expect(runtime.state.inFlight.size).toBe(0);
    runtime.stopScheduler();
  });

  test("gives up after the timeout when a refresh never settles", async () => {
    const never = new Promise<ContentItem[]>(() => {});
    const { config, adapters, panelMap } = slowSetup(never);
    const runtime = createSchedulerRuntime();
    runtime.startScheduler(config, adapters, panelMap);
    runtime.stopScheduler();

    const started = Date.now();
    await runtime.drainInFlight(20);
    expect(Date.now() - started).toBeLessThan(5_000);
    // The stuck run is still tracked; drain simply stopped waiting.
    expect(runtime.state.inFlight.size).toBe(1);
  });
});
