import type { Adapter, ContentItem } from "./adapters/types";
import { compareIsoTimestamp, errorMessage, getAdapterName } from "./utils";
import type { Model, Api } from "@mariozechner/pi-ai";
import { saveItems, getAllItemsByPanel, replacePanelItems, pruneOldItems as dbPruneOldItems } from "./db";
import type { AppConfig, IngestAdapterConfig, PipelineConfig, TransformConfig } from "./config";
import { runPipeline, type TransformContext } from "./transforms";
import type { ContentItemRow } from "./db";

interface RunningGuarded {
  running: boolean;
  lastError?: string;
}

interface TimedEntryBase extends RunningGuarded {
  panelIds: string[];
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  initialTimer?: ReturnType<typeof setTimeout> | null;
}

interface AdapterEntry extends TimedEntryBase {
  name: string;
  adapterConfig: IngestAdapterConfig;
  adapter: Adapter;
}

interface PipelineEntry extends TimedEntryBase {
  config: PipelineConfig;
  readKeys: Map<string, string>;
  initialTimer: ReturnType<typeof setTimeout> | null;
}

const adapterEntries: AdapterEntry[] = [];
const pipelineEntries: PipelineEntry[] = [];
let transformCtx: TransformContext = { llmModel: null };
let pruneTimer: ReturnType<typeof setInterval> | null = null;

/** Delay before first pipeline run (adapters fetch immediately on startup). */
export const PIPELINE_INITIAL_DELAY_MS = 5000;

/** Default adapter/pipeline refresh when `refresh_interval` is omitted (minutes). */
export const DEFAULT_REFRESH_INTERVAL_MIN = 15;

/** Floor for configured `refresh_interval` (minutes). */
export const MIN_REFRESH_INTERVAL_MIN = 1;

export interface RefreshResult {
  kind: "adapter" | "pipeline";
  name: string;
  status: "ok" | "skipped" | "failed";
  error?: string;
}

export interface SourcePanelMap {
  sourceToPanels: Map<string, string[]>;
  sourceToReadKey: Map<string, string>;
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
    console.warn(`scheduler: ${name} — error: ${msg}`);
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
  console.log(`scheduler: ${label} — every ${intervalMin}m`);
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

/** Concatenate source panels, newest first; equal timestamps keep concat order (stable sort). */
function gatherPipelineInputItems(
  sources: string[],
  readKeys: Map<string, string>,
): ContentItemRow[] {
  let items: ContentItemRow[] = [];
  for (const source of sources) {
    const readKey = readKeys.get(source) ?? source;
    items = items.concat(getAllItemsByPanel(readKey));
  }
  items.sort((a, b) => compareIsoTimestamp(a.timestamp, b.timestamp, "desc"));
  return items;
}

async function applyTransformsOnPanels(
  panelIds: string[],
  transforms: TransformConfig[],
  logName: string,
): Promise<void> {
  for (const pid of panelIds) {
    const allItems = getAllItemsByPanel(pid);
    const transformed = await runPipeline(allItems, transforms, transformCtx);
    replacePanelItems(pid, transformed);
    if (allItems.length !== transformed.length) {
      console.log(`scheduler: ${logName} — transforms: ${allItems.length} → ${transformed.length} items`);
    }
  }
}

export function startScheduler(
  config: AppConfig,
  adapters: Map<string, Adapter>,
  panelMap: SourcePanelMap,
  model?: Model<Api> | null,
): void {
  if (adapterEntries.length > 0 || pipelineEntries.length > 0) {
    return;
  }

  const missingAdapterTypes = Array.from(
    new Set(config.adapters.map((adapterCfg) => adapterCfg.type).filter((type) => !adapters.has(type)))
  );
  if (missingAdapterTypes.length === 1) {
    throw new Error(
      `scheduler: adapter type "${missingAdapterTypes[0]}" is configured but no matching adapter module was discovered`
    );
  }
  if (missingAdapterTypes.length > 1) {
    throw new Error(
      `scheduler: adapter types ${missingAdapterTypes.map((type) => `"${type}"`).join(", ")} are configured but no matching adapter modules were discovered`
    );
  }

  transformCtx = { llmModel: model ?? null, llmConfig: config.llm };

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

    runAdapter(entry);
    entry.timer = setInterval(() => runAdapter(entry), intervalMs);
    adapterEntries.push(entry);

    logScheduledRefresh(name, intervalMin);
  }

  if (config.pipelines) {
    for (const pipelineCfg of config.pipelines) {
      const panelIds = panelIdsForSource(pipelineCfg.name, panelMap);
      const readKeys = new Map<string, string>();
      for (const source of pipelineCfg.sources) {
        const key = panelMap.sourceToReadKey.get(source);
        if (key) readKeys.set(source, key);
      }
      const { intervalMin, intervalMs } = computeRefreshInterval(pipelineCfg.refresh_interval);

      const entry: PipelineEntry = {
        config: pipelineCfg,
        panelIds,
        readKeys,
        intervalMs,
        timer: null,
        initialTimer: null,
        running: false,
      };

      entry.initialTimer = setTimeout(() => {
        runPipelineJob(entry);
        entry.timer = setInterval(() => runPipelineJob(entry), intervalMs);
      }, PIPELINE_INITIAL_DELAY_MS);

      pipelineEntries.push(entry);
      logScheduledRefresh(`pipeline "${pipelineCfg.name}"`, intervalMin);
    }
  }

  pruneOldItems();
  pruneTimer = setInterval(pruneOldItems, 24 * 60 * 60 * 1000);
}

async function runAdapter(entry: AdapterEntry): Promise<RefreshResult> {
  const { name, panelIds, adapter, adapterConfig } = entry;
  return executeWithRunningGuard(entry, name, "adapter", async () => {
    const items = await adapter.fetch(adapterConfig);
    if (items.length > 0) {
      saveItemsToPanels(panelIds, items);
      console.log(`scheduler: ${name} — fetched ${items.length} items`);
    }

    const transforms = adapterConfig.transforms;
    if (transforms && transforms.length > 0) {
      await applyTransformsOnPanels(panelIds, transforms, name);
    }
  });
}

async function runPipelineJob(entry: PipelineEntry): Promise<RefreshResult> {
  const { config, panelIds, readKeys } = entry;
  const name = config.name;
  return executeWithRunningGuard(entry, name, "pipeline", async () => {
    const items = gatherPipelineInputItems(config.sources, readKeys);
    const transformed = await runPipeline(items, config.transforms, transformCtx);
    const namespaced = transformed.map((item) => ({
      ...item,
      id: `pipeline:${config.name}:${item.id}`,
    }));
    replaceItemsOnPanels(panelIds, namespaced);
    console.log(`scheduler: pipeline "${config.name}" — ${items.length} → ${transformed.length} items`);
  });
}

function pruneOldItems(): void {
  try {
    const changes = dbPruneOldItems(30);
    if (changes > 0) {
      console.log(`scheduler: pruned ${changes} items older than 30 days`);
    }
  } catch (err) {
    console.warn(`scheduler: failed to prune: ${errorMessage(err)}`);
  }
}

function namesInSet<T>(entries: readonly T[], getName: (e: T) => string, names: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const entry of entries) {
    const name = getName(entry);
    if (names.has(name)) out.add(name);
  }
  return out;
}

function filterByNames<T>(entries: readonly T[], getName: (e: T) => string, names: Set<string>): T[] {
  return entries.filter((e) => names.has(getName(e)));
}

function addPipelineSourcesTo(names: Set<string>, pipelines: readonly PipelineEntry[]): void {
  for (const pipeline of pipelines) {
    for (const source of pipeline.config.sources) {
      names.add(source);
    }
  }
}

/** `seed` pipeline names plus pipelines whose sources overlap the refresh scope (adapter names and sources from pipelines in `seed`). */
function dependentPipelineNames(adapterNames: Set<string>, seed: Set<string>): Set<string> {
  const names = new Set(seed);
  for (const pipeline of pipelineEntries) {
    if (names.has(pipeline.config.name)) continue;
    if (pipeline.config.sources.some((source) => adapterNames.has(source))) {
      names.add(pipeline.config.name);
    }
  }
  return names;
}

export async function refreshSources(sourceNames: string[]): Promise<RefreshResult[]> {
  const sourceNameSet = new Set(sourceNames);

  const selectedPipelines = filterByNames(pipelineEntries, (e) => e.config.name, sourceNameSet);
  const adapterNameSet = namesInSet(adapterEntries, (e) => e.name, sourceNameSet);
  addPipelineSourcesTo(adapterNameSet, selectedPipelines);

  const toRefresh = filterByNames(adapterEntries, (e) => e.name, adapterNameSet);
  const adapterResults = await Promise.all(toRefresh.map((e) => runAdapter(e)));

  const pipelineNameSet = dependentPipelineNames(
    adapterNameSet,
    new Set(selectedPipelines.map((e) => e.config.name)),
  );
  const pipelinesToRefresh = filterByNames(pipelineEntries, (e) => e.config.name, pipelineNameSet);
  const pipelineResults = await Promise.all(pipelinesToRefresh.map((e) => runPipelineJob(e)));

  return adapterResults.concat(pipelineResults);
}

function clearScheduledTimers(entry: TimedEntryBase): void {
  if (entry.timer) clearInterval(entry.timer);
  if (entry.initialTimer) clearTimeout(entry.initialTimer);
}

export function stopScheduler(): void {
  for (const entry of adapterEntries) clearScheduledTimers(entry);
  adapterEntries.length = 0;
  for (const entry of pipelineEntries) clearScheduledTimers(entry);
  pipelineEntries.length = 0;
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}
