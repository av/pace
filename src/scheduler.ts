import type { Adapter } from "./adapters/types";
import { errorMessage, getAdapterName } from "./utils";
import type { Model, Api } from "@mariozechner/pi-ai";
import { saveItems, getAllItemsByPanel, replacePanelItems, pruneOldItems as dbPruneOldItems } from "./db";
import type { AppConfig, IngestAdapterConfig, PipelineConfig } from "./config";
import { runPipeline, type TransformContext } from "./transforms";
import type { ContentItemRow } from "./db";

interface AdapterEntry {
  name: string;
  panelIds: string[];
  adapterConfig: IngestAdapterConfig;
  adapter: Adapter;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastError?: string;
}

interface PipelineEntry {
  config: PipelineConfig;
  panelIds: string[];
  readKeys: Map<string, string>;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  initialTimer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  lastError?: string;
}

const adapterEntries: AdapterEntry[] = [];
const pipelineEntries: PipelineEntry[] = [];
let transformCtx: TransformContext = { llmModel: null };
let pruneTimer: ReturnType<typeof setInterval> | null = null;

/** 5s initial delay before first pipeline run (while adapters fetch immediately on startup).
 * Extracted from magic literal per t3i fact ("pipelines are scheduled with a 5s initial delay");
 * also provides assertable hook for scheduler.test.ts coverage of startup sequence + default interval.
 */
export const PIPELINE_INITIAL_DELAY_MS = 5000;

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

/**
 * Shared internal helper to eliminate the duplicated running-guard, try/work, error handling (errorMessage + console.warn + lastError + failed result), finally reset, and ok return pattern
 * between runAdapter and runPipelineJob. Work is provided as a thunk that may throw (to trigger the shared catch path).
 * Preserves exact logs, results, and side effects for adapter and pipeline execution paths.
 */
async function executeWithRunningGuard(
  entry: { running: boolean; lastError?: string },
  name: string,
  kind: "adapter" | "pipeline",
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

/** Shared helper to compute refresh interval (default 15m, min 1m) in ms for both adapter and pipeline entries.
 * Eliminates the exact duplicated 2-line calc in startScheduler loops.
 */
function computeRefreshInterval(refreshInterval?: number): { intervalMin: number; intervalMs: number } {
  const intervalMin = Math.max(refreshInterval ?? 15, 1);
  const intervalMs = intervalMin * 60 * 1000;
  return { intervalMin, intervalMs };
}

export function startScheduler(
  config: AppConfig,
  adapters: Map<string, Adapter>,
  panelMap: SourcePanelMap,
  model?: Model<Api> | null,
): void {
  // Guard against duplicate starts (e.g. tests, reloads, multiple requires): ignore if already running
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
    const panelIds = panelMap.sourceToPanels.get(name) ?? [name];
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

    console.log(`scheduler: ${name} — every ${intervalMin}m`);
  }

  if (config.pipelines) {
    for (const pipelineCfg of config.pipelines) {
      const panelIds = panelMap.sourceToPanels.get(pipelineCfg.name) ?? [pipelineCfg.name];
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
      console.log(`scheduler: pipeline "${pipelineCfg.name}" — every ${intervalMin}m`);
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
      for (const pid of panelIds) saveItems(pid, items);
      console.log(`scheduler: ${name} — fetched ${items.length} items`);
    }

    if (adapterConfig.transforms && adapterConfig.transforms.length > 0) {
      for (const pid of panelIds) {
        const allItems = getAllItemsByPanel(pid);
        const transformed = await runPipeline(allItems, adapterConfig.transforms, transformCtx);
        replacePanelItems(pid, transformed);
        if (allItems.length !== transformed.length) {
          console.log(`scheduler: ${name} — transforms: ${allItems.length} → ${transformed.length} items`);
        }
      }
    }
  });
}

async function runPipelineJob(entry: PipelineEntry): Promise<RefreshResult> {
  const { config, panelIds, readKeys } = entry;
  const name = config.name;
  return executeWithRunningGuard(entry, name, "pipeline", async () => {
    let items: ContentItemRow[] = [];
    for (const source of config.sources) {
      const readKey = readKeys.get(source) ?? source;
      items = items.concat(getAllItemsByPanel(readKey));
    }
    items.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));

    const transformed = await runPipeline(items, config.transforms, transformCtx);
    const namespaced = transformed.map((item) => ({
      ...item,
      id: `pipeline:${config.name}:${item.id}`,
    }));
    for (const pid of panelIds) replacePanelItems(pid, namespaced);
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
    console.warn(`scheduler: prune error: ${errorMessage(err)}`);
  }
}

export async function refreshSources(sourceNames: string[]): Promise<RefreshResult[]> {
  const sourceNameSet = new Set(sourceNames);
  const selectedPipelines = pipelineEntries.filter((e) => sourceNameSet.has(e.config.name));
  const adapterNameSet = new Set(
    adapterEntries.filter((e) => sourceNameSet.has(e.name)).map((e) => e.name)
  );

  for (const pipeline of selectedPipelines) {
    for (const source of pipeline.config.sources) {
      adapterNameSet.add(source);
    }
  }

  const toRefresh = adapterEntries.filter((e) => adapterNameSet.has(e.name));
  const adapterResults = await Promise.all(toRefresh.map((e) => runAdapter(e)));

  const pipelineNameSet = new Set(selectedPipelines.map((e) => e.config.name));
  for (const pipeline of pipelineEntries) {
    if (pipeline.config.sources.some((source) => adapterNameSet.has(source))) {
      pipelineNameSet.add(pipeline.config.name);
    }
  }

  const pipelinesToRefresh = pipelineEntries.filter((e) => pipelineNameSet.has(e.config.name));
  const pipelineResults = await Promise.all(pipelinesToRefresh.map((e) => runPipelineJob(e)));

  return adapterResults.concat(pipelineResults);
}

export function stopScheduler(): void {
  for (const entry of adapterEntries) {
    if (entry.timer) clearInterval(entry.timer);
  }
  adapterEntries.length = 0;
  for (const entry of pipelineEntries) {
    if (entry.timer) clearInterval(entry.timer);
    if (entry.initialTimer) clearTimeout(entry.initialTimer);
  }
  pipelineEntries.length = 0;
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}
