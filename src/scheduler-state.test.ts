import { describe, test, expect } from "bun:test";
import { createSchedulerState } from "./scheduler-state";
import { makeMockAdapter } from "./test/adapter-mocks";

describe("SchedulerState", () => {
  describe("isStarted", () => {
    test("returns false when no entries are registered", () => {
      const state = createSchedulerState();
      expect(state.isStarted()).toBe(false);
    });

    test("returns true when adapter entries exist", () => {
      const state = createSchedulerState();
      state.adapterEntries.push({
        name: "a",
        panelIds: ["p"],
        adapterConfig: { type: "test" },
        adapter: makeMockAdapter([]),
        intervalMs: 1000,
        prunePanelIds: [],
        timer: null,
        running: false,
      });
      expect(state.isStarted()).toBe(true);
    });

    test("returns true when pipeline entries exist", () => {
      const state = createSchedulerState();
      state.pipelineEntries.push({
        config: { name: "pipe", sources: ["src"], transforms: [] },
        panelIds: ["p"],
        intervalMs: 1000,
        timer: null,
        initialTimer: null,
        running: false,
      });
      expect(state.isStarted()).toBe(true);
    });
  });

  test("reset clears entries, maps, and prune timer", () => {
    const schedulerState = createSchedulerState();
    const pruneTimer = setInterval(() => {}, 60_000);
    schedulerState.adapterEntries.push({
      name: "a",
      panelIds: ["p"],
      adapterConfig: { type: "test" },
      adapter: makeMockAdapter([]),
      intervalMs: 1000,
      prunePanelIds: [],
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
});