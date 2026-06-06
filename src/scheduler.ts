import type { Adapter, ContentItem } from "./adapters/types";
import { compareIsoTimestamp, errorMessage, getAdapterName } from "./utils";
import type { Model, Api } from "@mariozechner/pi-ai";
import {
  type ContentItemRow,
  saveItems,
  getAllItemsByPanel,
  replacePanelItems,
  pruneOldItems as dbPruneOldItems,
} from "./db";
import type { AppConfig, IngestAdapterConfig, PipelineConfig, TransformConfig } from "./config";
import { runPipeline, type TransformContext } from "./transforms";

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

export const PIPELINE_INITIAL_DELAY_MS = 5000;
export const DEFAULT_REFRESH_INTERVAL_MIN = 15;
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
    console.warn(`scheduler: failed to refresh ${name}: ${msg}`);
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

type TransformLogMode = "when-changed" | "always";

interface RunTransformsOptions {
  logLabel: string;
  logMode?: TransformLogMode;
  logDetail?: string;
  mapOutput?: (items: ContentItemRow[]) => ContentItemRow[];
}

async function runTransformsAndReplaceOnPanels(
  panelIds: string[],
  items: ContentItemRow[],
  transforms: TransformConfig[],
  options: RunTransformsOptions,
): Promise<void> {
  const transformed = await runPipeline(items, transforms, transformCtx);
  const output = options.mapOutput ? options.mapOutput(transformed) : transformed;
  replaceItemsOnPanels(panelIds, output);
  const logMode = options.logMode ?? "when-changed";
  if (logMode === "always" || items.length !== transformed.length) {
    const detail = options.logDetail ? `${options.logDetail} ` : "";
    console.log(`scheduler: ${options.logLabel} — ${detail}${items.length} → ${transformed.length} items`);
  }
}

async function applyTransformsOnPanels(
  panelIds: string[],
  transforms: TransformConfig[],
  logName: string,
): Promise<void> {
  for (const pid of panelIds) {
    await runTransformsAndReplaceOnPanels([pid], getAllItemsByPanel(pid), transforms, {
      logLabel: logName,
      logDetail: "transforms:",
    });
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
  if (missingAdapterTypes.length > 0) {
    throw new Error(missingAdapterTypesMessage(missingAdapterTypes));
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
    await runTransformsAndReplaceOnPanels(panelIds, items, config.transforms, {
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
      console.log(`scheduler: pruned ${changes} items older than 30 days`);
    }
  } catch (err) {
    console.warn(`scheduler: failed to prune: ${errorMessage(err)}`);
  }
}

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

function planRefresh(sourceNames: readonly string[]): {
  adapters: AdapterEntry[];
  pipelines: PipelineEntry[];
} {
  const sourceNameSet = new Set(sourceNames);

  const selectedPipelines = pipelineEntries.filter((entry) =>
    sourceNameSet.has(entry.config.name),
  );
  const adapterNameSet = new Set(
    adapterEntries.filter((entry) => sourceNameSet.has(entry.name)).map((entry) => entry.name),
  );
  for (const pipeline of selectedPipelines) {
    for (const source of pipeline.config.sources) adapterNameSet.add(source);
  }

  const pipelineNameSet = dependentPipelineNames(
    adapterNameSet,
    new Set(selectedPipelines.map((entry) => entry.config.name)),
  );

  return {
    adapters: adapterEntries.filter((entry) => adapterNameSet.has(entry.name)),
    pipelines: pipelineEntries.filter((entry) => pipelineNameSet.has(entry.config.name)),
  };
}

export function allPanelRefreshSourceNames(
  adapterNames: readonly string[],
  pipelines: readonly { name: string }[] | undefined,
): string[] {
  const names = [...adapterNames];
  if (pipelines) {
    for (const pipeline of pipelines) names.push(pipeline.name);
  }
  return names;
}

export async function refreshSources(sourceNames: string[]): Promise<RefreshResult[]> {
  const { adapters, pipelines } = planRefresh(sourceNames);

  const adapterResults = await Promise.all(adapters.map((entry) => runAdapter(entry)));
  const pipelineResults = await Promise.all(pipelines.map((entry) => runPipelineJob(entry)));

  return adapterResults.concat(pipelineResults);
}

function clearScheduledTimers(entry: TimedEntryBase): void {
  if (entry.timer) clearInterval(entry.timer);
  if (entry.initialTimer) clearTimeout(entry.initialTimer);
}

export function stopScheduler(): void {
  for (const entry of [...adapterEntries, ...pipelineEntries]) clearScheduledTimers(entry);
  adapterEntries.length = 0;
  pipelineEntries.length = 0;
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}
