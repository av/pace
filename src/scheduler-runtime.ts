import type { Adapter, ContentItem } from "./adapters/types";
import type { RefreshResult } from "./refresh-result";
import { logScheduler, warnPruneFailure, warnRefreshFailure } from "./scheduler-warn";
import { compareIsoTimestamp, errorMessage, getAdapterName } from "./utils";

import type { Model, Api } from "@mariozechner/pi-ai";
import {
  type ContentItemRow,
  saveItems,
  getAllItemsByPanel,
  replacePanelItems,
  pruneOldItems as dbPruneOldItems,
} from "./db";
import type { AppConfig, TransformConfig } from "./config/types";
import { runPipeline } from "./transforms";
import {
  createSchedulerState,
  type AdapterEntry,
  type PipelineEntry,
  type RunningGuarded,
  type SchedulerState,
  type TimedEntryBase,
} from "./scheduler-state";

export const PIPELINE_INITIAL_DELAY_MS = 5000;
export const DEFAULT_REFRESH_INTERVAL_MIN = 15;
export const MIN_REFRESH_INTERVAL_MIN = 1;

export interface SourcePanelMap {
  sourceToPanels: Map<string, string[]>;
  sourceToReadKey: Map<string, string>;
}

export interface SchedulerRuntime {
  readonly state: SchedulerState;
  startScheduler(
    config: AppConfig,
    adapters: Map<string, Adapter>,
    panelMap: SourcePanelMap,
    model?: Model<Api> | null,
  ): void;
  stopScheduler(): void;
  refreshSources(sourceNames: string[]): Promise<RefreshResult[]>;
}

async function executeWithRunningGuard(
  entry: RunningGuarded,
  name: string,
  kind: RefreshResult["kind"],
  work: () => Promise<void>,
): Promise<RefreshResult> {
  if (entry.running) return { kind, name, status: "skipped" };
  entry.running = true;
  try {
    await work();
    return { kind, name, status: "ok" };
  } catch (err) {
    const msg = errorMessage(err);
    warnRefreshFailure(name, err);
    entry.lastError = msg;
    return { kind, name, status: "failed", error: msg };
  } finally {
    entry.running = false;
  }
}

function computeRefreshInterval(refreshInterval?: number): { intervalMin: number; intervalMs: number } {
  const intervalMin = Math.max(
    refreshInterval ?? DEFAULT_REFRESH_INTERVAL_MIN,
    MIN_REFRESH_INTERVAL_MIN,
  );
  const intervalMs = intervalMin * 60 * 1000;
  return { intervalMin, intervalMs };
}

function logScheduledRefresh(label: string, intervalMin: number): void {
  logScheduler(`${label} - every ${intervalMin}m`);
}

function scheduleTimedEntryRefresh<T extends TimedEntryBase>(
  entry: T,
  run: (entry: T) => Promise<RefreshResult>,
  options: { initialDelayMs?: number } = {},
): void {
  const startInterval = (): void => {
    entry.timer = setInterval(() => run(entry), entry.intervalMs);
  };

  const runOnceAndSchedule = (): void => {
    void run(entry);
    startInterval();
  };

  const initialDelayMs = options.initialDelayMs ?? 0;
  if (initialDelayMs > 0) {
    entry.initialTimer = setTimeout(runOnceAndSchedule, initialDelayMs);
  } else {
    runOnceAndSchedule();
  }
}

function missingAdapterTypesMessage(types: readonly string[]): string {
  const quoted = types.map((type) => `"${type}"`).join(", ");
  if (types.length === 1) {
    return `scheduler: adapter type ${quoted} is configured but no matching adapter module was discovered`;
  }
  return `scheduler: adapter types ${quoted} are configured but no matching adapter modules were discovered`;
}

function panelIdsForSource(sourceName: string, panelMap: SourcePanelMap): string[] {
  return panelMap.sourceToPanels.get(sourceName) ?? [sourceName];
}

function saveItemsToPanels(panelIds: string[], items: ContentItem[]): void {
  for (const pid of panelIds) saveItems(pid, items);
}

function replaceItemsOnPanels(panelIds: string[], items: ContentItemRow[]): void {
  for (const pid of panelIds) replacePanelItems(pid, items);
}

function gatherPipelineInputItems(scheduler: SchedulerState, sources: string[]): ContentItemRow[] {
  let items: ContentItemRow[] = [];
  for (const source of sources) {
    const readKey = scheduler.sourceToReadKey.get(source) ?? source;
    items = items.concat(getAllItemsByPanel(readKey));
  }
  items.sort((a, b) => compareIsoTimestamp(a.timestamp, b.timestamp, "desc"));
  return items;
}

type TransformLogMode = "when-changed" | "always";

interface RunTransformsOptions {
  logLabel: string;
  logMode?: TransformLogMode;
  logDetail?: string;
  mapOutput?: (items: ContentItemRow[]) => ContentItemRow[];
}

async function runTransformsAndReplaceOnPanels(
  scheduler: SchedulerState,
  panelIds: string[],
  items: ContentItemRow[],
  transforms: TransformConfig[],
  options: RunTransformsOptions,
): Promise<void> {
  const transformed = await runPipeline(items, transforms, scheduler.transformCtx);
  const output = options.mapOutput ? options.mapOutput(transformed) : transformed;
  replaceItemsOnPanels(panelIds, output);
  const logMode = options.logMode ?? "when-changed";
  if (logMode === "always" || items.length !== transformed.length) {
    const detail = options.logDetail ? `${options.logDetail} ` : "";
    logScheduler(`${options.logLabel} - ${detail}${items.length} -> ${transformed.length} items`);
  }
}

async function applyTransformsOnPanels(
  scheduler: SchedulerState,
  panelIds: string[],
  transforms: TransformConfig[],
  logName: string,
): Promise<void> {
  for (const pid of panelIds) {
    await runTransformsAndReplaceOnPanels(scheduler, [pid], getAllItemsByPanel(pid), transforms, {
      logLabel: logName,
      logDetail: "transforms:",
    });
  }
}

async function runAdapter(scheduler: SchedulerState, entry: AdapterEntry): Promise<RefreshResult> {
  const { name, panelIds, adapter, adapterConfig } = entry;
  return executeWithRunningGuard(entry, name, "adapter", async () => {
    const items = await adapter.fetch(adapterConfig);
    if (items.length > 0) {
      saveItemsToPanels(panelIds, items);
      logScheduler(`${name} - fetched ${items.length} items`);
    }

    const transforms = adapterConfig.transforms;
    if (transforms && transforms.length > 0) {
      await applyTransformsOnPanels(scheduler, panelIds, transforms, name);
    }
  });
}

async function runPipelineJob(scheduler: SchedulerState, entry: PipelineEntry): Promise<RefreshResult> {
  const { config, panelIds } = entry;
  const name = config.name;
  return executeWithRunningGuard(entry, name, "pipeline", async () => {
    const items = gatherPipelineInputItems(scheduler, config.sources);
    await runTransformsAndReplaceOnPanels(scheduler, panelIds, items, config.transforms, {
      logLabel: `pipeline "${config.name}"`,
      logMode: "always",
      mapOutput: (transformed) =>
        transformed.map((item) => ({
          ...item,
          id: `pipeline:${config.name}:${item.id}`,
        })),
    });
  });
}

function pruneOldItems(): void {
  try {
    const changes = dbPruneOldItems(30);
    if (changes > 0) {
      logScheduler(`pruned ${changes} items older than 30 days`);
    }
  } catch (err) {
    warnPruneFailure(err);
  }
}

function dependentPipelineNames(scheduler: SchedulerState, adapterNames: Set<string>, seed: Set<string>): Set<string> {
  const names = new Set(seed);
  for (const pipeline of scheduler.pipelineEntries) {
    if (names.has(pipeline.config.name)) continue;
    if (pipeline.config.sources.some((source) => adapterNames.has(source))) {
      names.add(pipeline.config.name);
    }
  }
  return names;
}

function planRefresh(scheduler: SchedulerState, sourceNames: readonly string[]): {
  adapters: AdapterEntry[];
  pipelines: PipelineEntry[];
} {
  const sourceNameSet = new Set(sourceNames);

  const selectedPipelines = scheduler.pipelineEntries.filter((entry) =>
    sourceNameSet.has(entry.config.name),
  );
  const adapterNameSet = new Set(
    scheduler.adapterEntries.filter((entry) => sourceNameSet.has(entry.name)).map((entry) => entry.name),
  );
  for (const pipeline of selectedPipelines) {
    for (const source of pipeline.config.sources) adapterNameSet.add(source);
  }

  const pipelineNameSet = dependentPipelineNames(
    scheduler,
    adapterNameSet,
    new Set(selectedPipelines.map((entry) => entry.config.name)),
  );

  return {
    adapters: scheduler.adapterEntries.filter((entry) => adapterNameSet.has(entry.name)),
    pipelines: scheduler.pipelineEntries.filter((entry) => pipelineNameSet.has(entry.config.name)),
  };
}

function clearScheduledTimers(entry: TimedEntryBase): void {
  if (entry.timer) clearInterval(entry.timer);
  if (entry.initialTimer) clearTimeout(entry.initialTimer);
}

/** Scheduler operations bound to one mutable state - use for test isolation or custom lifecycles. */
export function createSchedulerRuntime(state: SchedulerState = createSchedulerState()): SchedulerRuntime {
  return {
    state,

    startScheduler(
      config: AppConfig,
      adapters: Map<string, Adapter>,
      panelMap: SourcePanelMap,
      model?: Model<Api> | null,
    ): void {
      if (state.isStarted()) {
        return;
      }

      const missingAdapterTypes = Array.from(
        new Set(config.adapters.map((adapterCfg) => adapterCfg.type).filter((type) => !adapters.has(type)))
      );
      if (missingAdapterTypes.length > 0) {
        throw new Error(missingAdapterTypesMessage(missingAdapterTypes));
      }

      state.transformCtx = { llmModel: model ?? null, llmConfig: config.llm };
      state.sourceToReadKey = panelMap.sourceToReadKey;

      for (const adapterCfg of config.adapters) {
        const adapter = adapters.get(adapterCfg.type);
        if (!adapter) continue;

        const name = getAdapterName(adapterCfg);
        const panelIds = panelIdsForSource(name, panelMap);
        const { intervalMin, intervalMs } = computeRefreshInterval(adapterCfg.refresh_interval);

        const entry: AdapterEntry = {
          name,
          panelIds,
          adapterConfig: adapterCfg,
          adapter,
          intervalMs,
          timer: null,
          running: false,
        };

        scheduleTimedEntryRefresh(entry, (e) => runAdapter(state, e));
        state.adapterEntries.push(entry);

        logScheduledRefresh(name, intervalMin);
      }

      if (config.pipelines) {
        for (const pipelineCfg of config.pipelines) {
          const panelIds = panelIdsForSource(pipelineCfg.name, panelMap);
          const { intervalMin, intervalMs } = computeRefreshInterval(pipelineCfg.refresh_interval);

          const entry: PipelineEntry = {
            config: pipelineCfg,
            panelIds,
            intervalMs,
            timer: null,
            initialTimer: null,
            running: false,
          };

          scheduleTimedEntryRefresh(entry, (e) => runPipelineJob(state, e), {
            initialDelayMs: PIPELINE_INITIAL_DELAY_MS,
          });

          state.pipelineEntries.push(entry);
          logScheduledRefresh(`pipeline "${pipelineCfg.name}"`, intervalMin);
        }
      }

      pruneOldItems();
      state.pruneTimer = setInterval(pruneOldItems, 24 * 60 * 60 * 1000);
    },

    stopScheduler(): void {
      state.reset(clearScheduledTimers);
    },

    async refreshSources(sourceNames: string[]): Promise<RefreshResult[]> {
      const { adapters, pipelines } = planRefresh(state, sourceNames);

      const adapterResults = await Promise.all(adapters.map((entry) => runAdapter(state, entry)));
      const pipelineResults = await Promise.all(pipelines.map((entry) => runPipelineJob(state, entry)));

      return adapterResults.concat(pipelineResults);
    },
  };
}