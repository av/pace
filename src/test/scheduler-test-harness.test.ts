import { describe, test, expect } from "bun:test";
import type { SchedulerRuntime } from "../scheduler";
import { getDefaultSchedulerRuntime } from "../scheduler";
import { adaptersMap, makeMockAdapter } from "./adapter-mocks";
import { makeContentItem } from "./content-items";
import { singlePanelLayout, testAppConfig } from "./app-config";
import { sourcePanelMapFromConfig } from "./panel-map";
import {
  installSchedulerRuntimeHooks,
  refreshTestSources,
  schedulerTestRuntime,
  startTestScheduler,
  stopTestScheduler,
  withSchedulerRuntime,
} from "./scheduler-test-harness";

describe("scheduler-test-harness contracts", () => {
  test("schedulerTestRuntime throws when hooks not installed", () => {
    expect(() => schedulerTestRuntime()).toThrow(
      "scheduler-test-harness: no runtime — call installSchedulerRuntimeHooks() in describe()",
    );
  });
});

describe("installSchedulerRuntimeHooks", () => {
  installSchedulerRuntimeHooks();

  let firstRuntime: SchedulerRuntime;

  test("provisions a fresh isolated runtime per test", () => {
    firstRuntime = schedulerTestRuntime();
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    const config = testAppConfig(
      { adapters: [{ type: "test", name: "iso", refresh_interval: 60 }] },
      singlePanelLayout("p", "iso", { id: "isoPanel" }),
    );
    startTestScheduler(config, adapters, sourcePanelMapFromConfig(config), null);
    expect(firstRuntime.state.isStarted()).toBe(true);
  });

  test("replaces runtime between tests (no state leak)", () => {
    expect(schedulerTestRuntime()).not.toBe(firstRuntime);
    expect(schedulerTestRuntime().state.isStarted()).toBe(false);
    expect(getDefaultSchedulerRuntime().state.isStarted()).toBe(false);
  });

  test("startTestScheduler and refreshTestSources use isolated runtime, not default", async () => {
    const items = [
      makeContentItem({ id: "i1", title: "t", url: "https://u", source: "iso" }),
    ];
    const adapters = adaptersMap(["test", makeMockAdapter(items)]);
    const config = testAppConfig(
      { adapters: [{ type: "test", name: "iso", refresh_interval: 60 }] },
      singlePanelLayout("p", "iso", { id: "isoPanel" }),
    );
    const pm = sourcePanelMapFromConfig(config);

    startTestScheduler(config, adapters, pm, null);
    expect(schedulerTestRuntime().state.isStarted()).toBe(true);
    expect(getDefaultSchedulerRuntime().state.isStarted()).toBe(false);

    const results = await refreshTestSources(["iso"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ kind: "adapter", name: "iso" });
    expect(await getDefaultSchedulerRuntime().refreshSources(["iso"])).toEqual([]);
  });

  test("stopTestScheduler stops isolated runtime without touching default", () => {
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    const config = testAppConfig(
      { adapters: [{ type: "test", name: "iso", refresh_interval: 60 }] },
      singlePanelLayout("p", "iso", { id: "isoPanel" }),
    );
    startTestScheduler(config, adapters, sourcePanelMapFromConfig(config), null);
    stopTestScheduler();
    expect(schedulerTestRuntime().state.isStarted()).toBe(false);
    expect(getDefaultSchedulerRuntime().state.isStarted()).toBe(false);
  });
});

describe("withSchedulerRuntime", () => {
  test("provisions short-lived runtime and stops on exit", async () => {
    let captured: SchedulerRuntime | undefined;
    const adapters = adaptersMap(["test", makeMockAdapter([])]);
    const config = testAppConfig(
      { adapters: [{ type: "test", name: "tmp", refresh_interval: 60 }] },
      singlePanelLayout("p", "tmp", { id: "tmpPanel" }),
    );
    const pm = sourcePanelMapFromConfig(config);

    const value = await withSchedulerRuntime(async (runtime) => {
      captured = runtime;
      runtime.startScheduler(config, adapters, pm, null);
      expect(runtime.state.isStarted()).toBe(true);
      expect(getDefaultSchedulerRuntime().state.isStarted()).toBe(false);
      return 42;
    });

    expect(value).toBe(42);
    expect(captured?.state.isStarted()).toBe(false);
    expect(getDefaultSchedulerRuntime().state.isStarted()).toBe(false);
  });
});