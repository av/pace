import type { Adapter, ContentItem } from "./adapters/types";
import type { RefreshResult } from "./refresh-result";
import { logScheduler, warnPruneFailure, warnRefreshFailure } from "./scheduler-warn";
import { compareIsoTimestamp, errorMessage, getAdapterName } from "./utils";

import type { Model, Api } from "@mariozechner/pi-ai";
import {
  type ContentItemRow,
  saveItems,
  getPipelineInputItemsByPanel,
  getRawItemsByPanel,
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
/** Id namespace for pipeline output items: `pipeline:<name>:<sourceId>`. Mirrored in db.ts dedup tie-break SQL. */
export const PIPELINE_ID_PREFIX = "pipeline:";
export const DEFAULT_REFRESH_INTERVAL_MIN = 15;
export const MIN_REFRESH_INTERVAL_MIN = 1;
// setInterval/setTimeout delays are 32-bit signed ints; larger values clamp to
// ~1ms and would cause a tight refresh loop hammering sources.
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
export const MAX_REFRESH_INTERVAL_MIN = Math.floor(MAX_TIMER_DELAY_MS / 60_000);

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
  /**
   * Wait (up to timeoutMs) for refresh runs already in flight to settle.
   * Call after stopScheduler() during shutdown so the DB is not closed under
   * an active refresh. Resolves immediately when nothing is running.
   */
  drainInFlight(timeoutMs?: number): Promise<void>;
}

export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

/** Register a refresh run for shutdown draining; removes itself on settle. */
function trackInFlight(state: SchedulerState, promise: Promise<RefreshResult>): Promise<RefreshResult> {
  state.inFlight.add(promise);
  // executeWithRunningGuard never rejects, but guard anyway so tracking can
  // never surface an unhandled rejection.
  void promise.catch(() => {}).finally(() => state.inFlight.delete(promise));
  return promise;
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

export function computeRefreshInterval(refreshInterval?: number): { intervalMin: number; intervalMs: number } {
  const requestedMin = Math.max(
    refreshInterval ?? DEFAULT_REFRESH_INTERVAL_MIN,
    MIN_REFRESH_INTERVAL_MIN,
  );
  const intervalMin = Math.min(requestedMin, MAX_REFRESH_INTERVAL_MIN);
  if (intervalMin !== requestedMin) {
    logScheduler(
      `refresh_interval ${requestedMin}m exceeds the maximum timer delay; clamped to ${intervalMin}m`,
    );
  }
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

function gatherPipelineInputItems(
  scheduler: SchedulerState,
  sources: string[],
): ContentItemRow[] {
  // When a panel lists both an adapter and one or more pipelines consuming
  // that adapter, the adapter's read key is that shared panel, so pipeline
  // output (ids prefixed `pipeline:<name>:`) is read back as input on every
  // refresh. Pipeline sources are always adapters (config validation rejects
  // pipeline names), so ANY pipeline-prefixed item here is contamination from
  // a shared panel: without this filter each cycle re-transforms
  // already-transformed items (duplicate LLM work) and re-prefixes ids
  // without bound (pipeline:x:pipeline:y:pipeline:x:...).
  // Two sources can resolve to the same read key (e.g. both adapters feed
  // one shared panel), so read each distinct read key exactly once —
  // otherwise every row on that panel is duplicated per source.
  const readKeys = new Set<string>();
  for (const source of sources) {
    readKeys.add(scheduler.sourceToReadKey.get(source) ?? source);
  }
  let items: ContentItemRow[] = [];
  for (const readKey of readKeys) {
    items = items.concat(getPipelineInputItemsByPanel(readKey));
  }
  items.sort((a, b) => compareIsoTimestamp(a.timestamp, b.timestamp, "desc"));
  // Composite (id, panel_id) storage means the SAME item can live as a copy
  // on two different read-key panels (e.g. one adapter feeding two panels
  // that two pipeline sources resolve to). Keep only the newest copy per id
  // so count-limited transforms don't spend slots on duplicates.
  const seenIds = new Set<string>();
  const deduped: ContentItemRow[] = [];
  for (const item of items) {
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

type TransformLogMode = "when-changed" | "always";

interface RunTransformsOptions {
  logLabel: string;
  logMode?: TransformLogMode;
  logDetail?: string;
  mapOutput?: (items: ContentItemRow[]) => ContentItemRow[];
  /**
   * When set, items already on a target panel that match this predicate are
   * kept alongside the new output instead of being wiped by the replace.
   * Used by pipeline jobs so a panel shared with a source adapter retains the
   * adapter's raw items.
   */
  retainPanelItem?: (item: ContentItemRow) => boolean;
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
  const { retainPanelItem } = options;
  if (retainPanelItem) {
    const outputIds = new Set(output.map((item) => item.id));
    for (const pid of panelIds) {
      // Raw read: a deduped read would collapse a raw item with its own
      // pipeline copy and the rewrite would drop the dedup loser.
      const retained = getRawItemsByPanel(pid).filter(
        (item) => retainPanelItem(item) && !outputIds.has(item.id),
      );
      replacePanelItems(pid, output.concat(retained));
    }
  } else {
    replaceItemsOnPanels(panelIds, output);
  }
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
    // Adapter-level transforms must only see (and rewrite) the adapter's raw
    // items. On a panel shared with a pipeline, a plain deduped read would
    // surface the pipeline's copies (the dedup tie-break prefers them), so the
    // transforms would re-process pipeline output and the replace would wipe
    // it. Read the pipeline-free deduped view and retain pipeline rows.
    await runTransformsAndReplaceOnPanels(
      scheduler,
      [pid],
      getPipelineInputItemsByPanel(pid),
      transforms,
      {
        logLabel: logName,
        logDetail: "transforms:",
        retainPanelItem: (item) => item.id.startsWith(PIPELINE_ID_PREFIX),
      },
    );
  }
}

async function runAdapter(scheduler: SchedulerState, entry: AdapterEntry): Promise<RefreshResult> {
  const { name, panelIds, adapter, adapterConfig } = entry;
  return executeWithRunningGuard(entry, name, "adapter", async () => {
    const items = await adapter.fetch(adapterConfig);
    // Lock the target panels for the save -> transform -> replace span:
    // transforms await mid-flight (e.g. LLM calls), and replacePanelItems
    // rewrites the panel from a snapshot read before that await. Without the
    // lock, a concurrent refresh of another source sharing a panel could save
    // items during the await and have them wiped by the stale replace.
    await scheduler.panelLocks.withLock(panelIds, async () => {
      if (items.length > 0) {
        saveItemsToPanels(panelIds, items);
        logScheduler(`${name} - fetched ${items.length} items`);
      }

      const transforms = adapterConfig.transforms;
      if (transforms && transforms.length > 0) {
        await applyTransformsOnPanels(scheduler, panelIds, transforms, name);
      }
    });
  });
}

async function runPipelineJob(scheduler: SchedulerState, entry: PipelineEntry): Promise<RefreshResult> {
  const { config, panelIds } = entry;
  const name = config.name;
  return executeWithRunningGuard(entry, name, "pipeline", () =>
    // Same panel-lock rationale as runAdapter: the output panels are rewritten
    // from a snapshot gathered before awaited transforms.
    scheduler.panelLocks.withLock(panelIds, async () => {
      const ownOutputPrefix = `${PIPELINE_ID_PREFIX}${config.name}:`;
      const items = gatherPipelineInputItems(scheduler, config.sources);
      await runTransformsAndReplaceOnPanels(scheduler, panelIds, items, config.transforms, {
        logLabel: `pipeline "${config.name}"`,
        logMode: "always",
        mapOutput: (transformed) =>
          transformed.map((item) => ({
            ...item,
            id: `${ownOutputPrefix}${item.id}`,
          })),
        // Only replace this pipeline's own output namespace: if an output
        // panel is shared with a source adapter or another pipeline, the
        // adapter's raw items and the other pipeline's output must survive
        // the replace (otherwise the next cycle would see an empty input
        // and wipe the panel).
        retainPanelItem: (item) => !item.id.startsWith(ownOutputPrefix),
      });
    }),
  );
}

export const DEFAULT_RETENTION_DAYS = 30;

function pruneOldItems(retentionDays: number): void {
  try {
    const changes = dbPruneOldItems(retentionDays);
    if (changes > 0) {
      logScheduler(`pruned ${changes} items older than ${retentionDays} days`);
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

        scheduleTimedEntryRefresh(entry, (e) => trackInFlight(state, runAdapter(state, e)));
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

          scheduleTimedEntryRefresh(entry, (e) => trackInFlight(state, runPipelineJob(state, e)), {
            initialDelayMs: PIPELINE_INITIAL_DELAY_MS,
          });

          state.pipelineEntries.push(entry);
          logScheduledRefresh(`pipeline "${pipelineCfg.name}"`, intervalMin);
        }
      }

      const retentionDays = config.server?.retention_days ?? DEFAULT_RETENTION_DAYS;
      if (retentionDays > 0) {
        pruneOldItems(retentionDays);
        state.pruneTimer = setInterval(() => pruneOldItems(retentionDays), 24 * 60 * 60 * 1000);
      } else {
        logScheduler("item pruning disabled (server.retention_days: 0)");
      }
    },

    stopScheduler(): void {
      state.reset(clearScheduledTimers);
    },

    async refreshSources(sourceNames: string[]): Promise<RefreshResult[]> {
      const { adapters, pipelines } = planRefresh(state, sourceNames);

      const adapterResults = await Promise.all(
        adapters.map((entry) => trackInFlight(state, runAdapter(state, entry))),
      );
      const pipelineResults = await Promise.all(
        pipelines.map((entry) => trackInFlight(state, runPipelineJob(state, entry))),
      );

      return adapterResults.concat(pipelineResults);
    },

    async drainInFlight(timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS): Promise<void> {
      // Snapshot: timers are expected to be stopped already, and in-flight
      // runs cannot enqueue new refreshes, so nothing new appears mid-drain.
      const pending = [...state.inFlight];
      if (pending.length === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, timeoutMs));
      });
      try {
        await Promise.race([Promise.allSettled(pending).then(() => undefined), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}