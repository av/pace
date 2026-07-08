import type { Adapter } from "./adapters/types";
import type { RefreshResult } from "./refresh-result";
import type { Model, Api } from "@mariozechner/pi-ai";
import type { AppConfig } from "./config/types";
import {
  createSchedulerRuntime,
  type SchedulerRuntime,
  type SourcePanelMap,
  PIPELINE_INITIAL_DELAY_MS,
  DEFAULT_REFRESH_INTERVAL_MIN,
  MIN_REFRESH_INTERVAL_MIN,
  DEFAULT_DRAIN_TIMEOUT_MS,
} from "./scheduler-runtime";

export type { RefreshResult } from "./refresh-result";
export { SchedulerState, createSchedulerState } from "./scheduler-state";
export {
  createSchedulerRuntime,
  type SchedulerRuntime,
  type SourcePanelMap,
  PIPELINE_INITIAL_DELAY_MS,
  DEFAULT_REFRESH_INTERVAL_MIN,
  MIN_REFRESH_INTERVAL_MIN,
  DEFAULT_DRAIN_TIMEOUT_MS,
};

const defaultRuntime = createSchedulerRuntime();

export function startScheduler(
  config: AppConfig,
  adapters: Map<string, Adapter>,
  panelMap: SourcePanelMap,
  model?: Model<Api> | null,
): void {
  defaultRuntime.startScheduler(config, adapters, panelMap, model);
}

export function stopScheduler(): void {
  defaultRuntime.stopScheduler();
}

export async function refreshSources(sourceNames: string[]): Promise<RefreshResult[]> {
  return defaultRuntime.refreshSources(sourceNames);
}

/** Wait (bounded) for in-flight refreshes to settle; see SchedulerRuntime.drainInFlight. */
export async function drainScheduler(timeoutMs?: number): Promise<void> {
  return defaultRuntime.drainInFlight(timeoutMs);
}