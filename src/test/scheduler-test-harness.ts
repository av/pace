import { beforeEach, afterEach } from "bun:test";
import type { Adapter } from "../adapters/types";
import type { AppConfig } from "../config/types";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { RefreshResult } from "../refresh-result";
import {
  createSchedulerRuntime,
  type RefreshHealth,
  type SchedulerRuntime,
  type SourcePanelMap,
} from "../scheduler";

let testRuntime: SchedulerRuntime | undefined;

/** Per-test isolated scheduler runtime (parallel-safe). */
function schedulerTestRuntime(): SchedulerRuntime {
  if (testRuntime === undefined) {
    throw new Error(
      "scheduler-test-harness: no runtime - call installSchedulerRuntimeHooks() in describe()",
    );
  }
  return testRuntime;
}

/** Install beforeEach/afterEach hooks that provision one isolated runtime per test. */
export function installSchedulerRuntimeHooks(): void {
  beforeEach(() => {
    testRuntime = createSchedulerRuntime();
  });

  afterEach(() => {
    testRuntime?.stopScheduler();
    testRuntime = undefined;
  });
}

export function startTestScheduler(
  config: AppConfig,
  adapters: Map<string, Adapter>,
  panelMap: SourcePanelMap,
  model?: Model<Api> | null,
): void {
  schedulerTestRuntime().startScheduler(config, adapters, panelMap, model);
}

export function stopTestScheduler(): void {
  schedulerTestRuntime().stopScheduler();
}

export async function refreshTestSources(sourceNames: string[]): Promise<RefreshResult[]> {
  return schedulerTestRuntime().refreshSources(sourceNames);
}

export function getTestRefreshHealth(): RefreshHealth {
  return schedulerTestRuntime().getRefreshHealth();
}