import type { Adapter, ContentItem } from "./adapters/types";
import type { RefreshResult } from "./refresh-result";
import { logScheduler, warnPruneFailure, warnRefreshFailure } from "./scheduler-warn";
import { compareIsoTimestamp, errorMessage, getAdapterName } from "./utils";

import type { Model, Api } from "@mariozechner/pi-ai";
import {
  type ContentItemRow,
  type SaveItemsOptions,
  saveItems,
  getPipelineInputItemsByPanel,
  getRawItemsByPanel,
  replacePanelItems,
  prunePanelItemsByIdPrefix,
  pruneForeignOwnedPanelItems,
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

/** Health of one scheduled refresh source, derived from its latest completed run. */
export interface SourceRefreshHealth {
  kind: RefreshResult["kind"];
  name: string;
  /** "pending" = no run has completed yet (e.g. right after startup). */
  status: "ok" | "failing" | "pending";
  lastError?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  /** Wall-clock duration (ms, integer) of the most recent completed run. */
  lastDurationMs?: number;
  /** Items produced by the most recent successful run (fetched for adapters, gathered inputs for pipelines). */
  lastItemCount?: number;
}

/** Aggregate refresh health across all scheduled sources. */
export interface RefreshHealth {
  /** "degraded" when at least one source's latest completed run failed. */
  status: "ok" | "degraded";
  sources: SourceRefreshHealth[];
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
  /** Snapshot per-source refresh health (latest completed run per source). */
  getRefreshHealth(): RefreshHealth;
  /**
   * Wait (up to timeoutMs) for refresh runs already in flight to settle.
   * Call after stopScheduler() during shutdown so the DB is not closed under
   * an active refresh. Resolves immediately when nothing is running.
   */
  drainInFlight(timeoutMs?: number): Promise<void>;
}

export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

/** Register a refresh run (or whole refresh chain) for shutdown draining; removes itself on settle. */
function trackInFlight<T>(state: SchedulerState, promise: Promise<T>): Promise<T> {
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
  work: () => Promise<number | void>,
): Promise<RefreshResult> {
  if (entry.running) return { kind, name, status: "skipped" };
  entry.running = true;
  const startedAt = performance.now();
  try {
    const itemCount = await work();
    entry.lastDurationMs = Math.round(performance.now() - startedAt);
    // Clear any stale failure so health reporting reflects the LATEST
    // completed run, not the last failure ever seen.
    entry.lastError = undefined;
    entry.lastSuccessAt = new Date().toISOString();
    if (typeof itemCount === "number") entry.lastItemCount = itemCount;
    return { kind, name, status: "ok" };
  } catch (err) {
    entry.lastDurationMs = Math.round(performance.now() - startedAt);
    const msg = errorMessage(err);
    warnRefreshFailure(name, err);
    entry.lastError = msg;
    entry.lastFailureAt = new Date().toISOString();
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

function saveItemsToPanels(
  panelIds: string[],
  items: ContentItem[],
  options?: SaveItemsOptions,
): void {
  for (const pid of panelIds) saveItems(pid, items, options);
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

function seedLlmFieldsFromPreviousOutput(
  items: ContentItemRow[],
  panelIds: string[],
  ownOutputPrefix: string,
): ContentItemRow[] {
  // llm-summarize skips rows that already carry a summary, and llm-rank skips
  // rows that already carry a score (transform-llm.ts) — llm-rank scores are
  // absolute per-item relevance, so a previous cycle's score stays valid.
  // But pipeline input is gathered from SOURCE panels (raw adapter rows, no
  // summaries or scores) while the values produced last cycle live on the
  // OUTPUT panels under rewritten `pipeline:<name>:<id>` ids. Without reuse
  // those caches never hit, so every cycle re-summarizes (and with
  // fetch_content, re-fetches) and re-scores every item. Seed each input row
  // missing a summary/score with the value from this pipeline's previous
  // output row of the same original id; a fresher value already on the input
  // row (e.g. from an adapter-level transform on the source panel) wins.
  const previousSummaries = new Map<string, string>();
  const previousScores = new Map<string, number>();
  for (const pid of panelIds) {
    for (const row of getRawItemsByPanel(pid)) {
      if (!row.id.startsWith(ownOutputPrefix)) continue;
      const originalId = row.id.slice(ownOutputPrefix.length);
      if (row.summary && !previousSummaries.has(originalId)) {
        previousSummaries.set(originalId, row.summary);
      }
      if (row.score != null && !previousScores.has(originalId)) {
        previousScores.set(originalId, row.score);
      }
    }
  }
  if (previousSummaries.size === 0 && previousScores.size === 0) return items;
  return items.map((row) => {
    const summary = row.summary ? undefined : previousSummaries.get(row.id);
    const score = row.score == null ? previousScores.get(row.id) : undefined;
    if (summary === undefined && score === undefined) return row;
    const seeded = { ...row };
    if (summary !== undefined) seeded.summary = summary;
    if (score !== undefined) seeded.score = score;
    return seeded;
  });
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
  entry: AdapterEntry,
  transforms: TransformConfig[],
): Promise<void> {
  for (const pid of entry.panelIds) {
    // Adapter-level transforms must only see (and rewrite) the adapter's raw
    // items. On a panel shared with a pipeline, a plain deduped read would
    // surface the pipeline's copies (the dedup tie-break prefers them), so the
    // transforms would re-process pipeline output and the replace would wipe
    // it. Read the pipeline-free deduped view and retain pipeline rows.
    //
    // On a panel shared with another ADAPTER source, scope further to this
    // source's own rows (owner_source): feeding co-tenant rows through e.g.
    // `latest count:5` would let the replace physically delete the other
    // adapter's items on every refresh cycle. Unowned rows (owner_source
    // null, saved before attribution existed) are retained untransformed;
    // they get stamped on their owner's next upsert.
    const shared = entry.sharedPanelIds.includes(pid);
    const rows = getPipelineInputItemsByPanel(pid);
    const input = shared ? rows.filter((item) => item.owner_source === entry.name) : rows;
    await runTransformsAndReplaceOnPanels(scheduler, [pid], input, transforms, {
      logLabel: entry.name,
      logDetail: "transforms:",
      retainPanelItem: (item) =>
        item.id.startsWith(PIPELINE_ID_PREFIX) ||
        (shared && item.owner_source !== entry.name),
    });
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
        // Declarative adapters fabricate `now`-based timestamps every fetch;
        // preserving the stored timestamp on upsert keeps items aging
        // naturally instead of re-stamping to "just now" each refresh.
        saveItemsToPanels(panelIds, items, {
          preserveStoredTimestamps: adapter.declarative === true,
          ownerSource: name,
        });
        logScheduler(`${name} - fetched ${items.length} items`);
      }

      // Declarative adapters (config-defined lists, e.g. bookmarks): the
      // fetch result is the complete set, so prune this adapter's rows that
      // are no longer in it — removed/reordered/renamed config entries would
      // otherwise linger (and, with index-embedded ids, duplicate) forever
      // under upsert-only saveItems. Runs even when the fetch is empty:
      // clearing the config list must clear the panel.
      if (adapter.declarative && entry.prunePanelIds.length > 0) {
        const keepIds = new Set(items.map((item) => item.id));
        const idPrefix = `${adapter.name}:`;
        for (const pid of entry.prunePanelIds) {
          const removed = prunePanelItemsByIdPrefix(pid, idPrefix, keepIds);
          if (removed > 0) {
            logScheduler(`${name} - pruned ${removed} stale item(s) removed from config`);
          }
        }
      }

      const transforms = adapterConfig.transforms;
      if (transforms && transforms.length > 0) {
        await applyTransformsOnPanels(scheduler, entry, transforms);
      }
    });
    return items.length;
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
      const items = seedLlmFieldsFromPreviousOutput(
        gatherPipelineInputItems(scheduler, config.sources),
        panelIds,
        ownOutputPrefix,
      );
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
      return items.length;
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

function sourceHealth(
  kind: RefreshResult["kind"],
  name: string,
  entry: RunningGuarded,
): SourceRefreshHealth {
  const status: SourceRefreshHealth["status"] = entry.lastError
    ? "failing"
    : entry.lastSuccessAt
      ? "ok"
      : "pending";
  return {
    kind,
    name,
    status,
    ...(entry.lastError !== undefined && { lastError: entry.lastError }),
    ...(entry.lastSuccessAt !== undefined && { lastSuccessAt: entry.lastSuccessAt }),
    ...(entry.lastFailureAt !== undefined && { lastFailureAt: entry.lastFailureAt }),
    ...(entry.lastDurationMs !== undefined && { lastDurationMs: entry.lastDurationMs }),
    ...(entry.lastItemCount !== undefined && { lastItemCount: entry.lastItemCount }),
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

      // Declarative pruning is per adapter TYPE (`${type}:` id prefix), so two
      // sources of the same declarative type feeding one panel would prune
      // each other's rows. Count declarative sources per (type, panel) and
      // withhold pruning on contested panels.
      const declarativePanelSources = new Map<string, number>();
      // Adapter sources per panel: panels fed by 2+ adapters need per-source
      // transform scoping (see AdapterEntry.sharedPanelIds).
      const adapterSourcesPerPanel = new Map<string, number>();
      // Adapter names per panel: used to reconcile stored rows against the
      // current config (see the stale-owner prune below).
      const adapterNamesByPanel = new Map<string, Set<string>>();
      for (const adapterCfg of config.adapters) {
        const adapter = adapters.get(adapterCfg.type);
        if (!adapter) continue;
        const adapterName = getAdapterName(adapterCfg);
        for (const pid of panelIdsForSource(adapterName, panelMap)) {
          adapterSourcesPerPanel.set(pid, (adapterSourcesPerPanel.get(pid) ?? 0) + 1);
          let names = adapterNamesByPanel.get(pid);
          if (!names) adapterNamesByPanel.set(pid, (names = new Set()));
          names.add(adapterName);
          if (!adapter.declarative) continue;
          const key = `${adapterCfg.type} ${pid}`;
          declarativePanelSources.set(key, (declarativePanelSources.get(key) ?? 0) + 1);
        }
      }

      for (const adapterCfg of config.adapters) {
        const adapter = adapters.get(adapterCfg.type);
        if (!adapter) continue;

        const name = getAdapterName(adapterCfg);
        const panelIds = panelIdsForSource(name, panelMap);
        const { intervalMin, intervalMs } = computeRefreshInterval(adapterCfg.refresh_interval);

        let prunePanelIds: string[] = [];
        if (adapter.declarative) {
          prunePanelIds = panelIds.filter(
            (pid) => declarativePanelSources.get(`${adapterCfg.type} ${pid}`) === 1,
          );
          const contested = panelIds.filter((pid) => !prunePanelIds.includes(pid));
          if (contested.length > 0) {
            logScheduler(
              `${name} - panel(s) ${contested.join(", ")} shared with another "${adapterCfg.type}" source; stale-item pruning disabled there (id namespaces collide)`,
            );
          }
        }

        const entry: AdapterEntry = {
          name,
          panelIds,
          adapterConfig: adapterCfg,
          adapter,
          intervalMs,
          timer: null,
          running: false,
          prunePanelIds,
          sharedPanelIds: panelIds.filter((pid) => (adapterSourcesPerPanel.get(pid) ?? 0) > 1),
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

      // Reconcile stored rows with the CURRENT config: when a config edit
      // removes or renames a source while a panel keeps its identity across
      // restarts (an explicit `id:`), rows saved under the old source name
      // would keep rendering as ghost items until the retention prune ages
      // them out (up to retention_days later). A panel's owned rows are
      // legitimate only if their owner still feeds it: adapter rows carry
      // their adapter's name, pipeline output rows carry the name of the
      // adapter whose row they were transformed from (which, on a shared
      // read-key panel, can be any co-tenant of the pipeline's source).
      // Unknown panel_ids (renamed panels, other configs sharing the db
      // file) are deliberately untouched.
      const allowedOwnersByPanel = new Map<string, Set<string>>();
      for (const [pid, names] of adapterNamesByPanel) {
        allowedOwnersByPanel.set(pid, new Set(names));
      }
      for (const entry of state.pipelineEntries) {
        const inputOwners = new Set<string>();
        for (const src of entry.config.sources) {
          inputOwners.add(src);
          const readKey = panelMap.sourceToReadKey.get(src) ?? src;
          for (const owner of adapterNamesByPanel.get(readKey) ?? []) {
            inputOwners.add(owner);
          }
        }
        for (const pid of entry.panelIds) {
          let owners = allowedOwnersByPanel.get(pid);
          if (!owners) allowedOwnersByPanel.set(pid, (owners = new Set()));
          for (const owner of inputOwners) owners.add(owner);
        }
      }
      try {
        for (const [pid, owners] of allowedOwnersByPanel) {
          const removed = pruneForeignOwnedPanelItems(pid, [...owners]);
          if (removed > 0) {
            logScheduler(
              `panel ${pid} - removed ${removed} stale item(s) from source(s) no longer feeding it`,
            );
          }
        }
      } catch (err) {
        warnPruneFailure(err);
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
      // Track the WHOLE chain, not only the individual runs: pipeline jobs are
      // registered only after the adapter phase settles, so a drain that
      // snapshotted mid-chain would resolve before the pipeline phase even
      // starts and shutdown could close the DB under its live panel writers.
      return trackInFlight(
        state,
        (async (): Promise<RefreshResult[]> => {
          const { adapters, pipelines } = planRefresh(state, sourceNames);

          const adapterResults = await Promise.all(
            adapters.map((entry) => trackInFlight(state, runAdapter(state, entry))),
          );
          const pipelineResults = await Promise.all(
            pipelines.map((entry) => trackInFlight(state, runPipelineJob(state, entry))),
          );

          return adapterResults.concat(pipelineResults);
        })(),
      );
    },

    getRefreshHealth(): RefreshHealth {
      const sources: SourceRefreshHealth[] = [
        ...state.adapterEntries.map((entry) => sourceHealth("adapter", entry.name, entry)),
        ...state.pipelineEntries.map((entry) => sourceHealth("pipeline", entry.config.name, entry)),
      ];
      return {
        status: sources.some((source) => source.status === "failing") ? "degraded" : "ok",
        sources,
      };
    },

    async drainInFlight(timeoutMs: number = DEFAULT_DRAIN_TIMEOUT_MS): Promise<void> {
      // Timers are expected to be stopped already, but settling runs CAN
      // register follow-up work (a refreshSources chain starts its pipeline
      // jobs only after the adapter phase settles), so a single snapshot is
      // not enough: re-snapshot until nothing is in flight or the deadline
      // passes.
      const deadline = Date.now() + Math.max(0, timeoutMs);
      while (state.inFlight.size > 0) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return;
        const pending = [...state.inFlight];
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, remainingMs);
        });
        try {
          await Promise.race([Promise.allSettled(pending).then(() => undefined), timeout]);
        } finally {
          clearTimeout(timer);
        }
        // Let settle continuations run (inFlight self-removal, chained run
        // registration) before re-checking, so the loop observes the new
        // state instead of re-awaiting an already-settled snapshot.
        await Promise.resolve();
      }
    },
  };
}