import { beforeEach, afterEach } from "bun:test";
import type { Adapter } from "../adapters/types";
import type { AppConfig } from "../config/types";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { RefreshResult } from "../refresh-result";
import {
  createSchedulerRuntime,
  type SchedulerRuntime,
  type SourcePanelMap,
} from "../scheduler";

let testRuntime: SchedulerRuntime | undefined;

/** Per-test isolated scheduler runtime (parallel-safe). */
export function schedulerTestRuntime(): SchedulerRuntime {
  if (testRuntime === undefined) {
    throw new Error(
      "scheduler-test-harness: no runtime — call installSchedulerRuntimeHooks() in describe()",
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

/** Short-lived runtime for tests that need a second isolated instance. */
export async function withSchedulerRuntime<T>(
  fn: (runtime: SchedulerRuntime) => Promise<T> | T,
): Promise<T> {
  const runtime = createSchedulerRuntime();
  try {
    return await fn(runtime);
  } finally {
    runtime.stopScheduler();
  }
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