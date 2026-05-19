import type { Adapter } from "./adapters/types";
import type { Model, Api } from "@mariozechner/pi-ai";
import { saveItems, getAllItemsByAdapter, replaceAdapterItems, getDb } from "./db";
import type { AppConfig, IngestAdapterConfig, PipelineConfig } from "./config";
import { runPipeline, type TransformContext } from "./transforms";
import type { ContentItemRow } from "./db";

interface AdapterEntry {
  name: string;
  adapterConfig: IngestAdapterConfig;
  adapter: Adapter;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
}

interface PipelineEntry {
  config: PipelineConfig;
  intervalMs: number;
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
}

const adapterEntries: AdapterEntry[] = [];
const pipelineEntries: PipelineEntry[] = [];
let transformCtx: TransformContext = { llmModel: null };
let pruneTimer: ReturnType<typeof setInterval> | null = null;

export interface RefreshResult {
  kind: "adapter" | "pipeline";
  name: string;
  status: "ok" | "skipped" | "failed";
  error?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function startScheduler(
  config: AppConfig,
  adapters: Map<string, Adapter>,
  model?: Model<Api> | null,
): void {
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

    const name = adapterCfg.name ?? adapterCfg.type;
    const intervalMin = Math.max(adapterCfg.refresh_interval ?? 15, 1);
    const intervalMs = intervalMin * 60 * 1000;

    const entry: AdapterEntry = {
      name,
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
      const intervalMin = Math.max(pipelineCfg.refresh_interval ?? 15, 1);
      const intervalMs = intervalMin * 60 * 1000;

      const entry: PipelineEntry = {
        config: pipelineCfg,
        intervalMs,
        timer: null,
        running: false,
      };

      // Delay first pipeline run to let source adapters fetch first
      setTimeout(() => {
        runPipelineJob(entry);
        entry.timer = setInterval(() => runPipelineJob(entry), intervalMs);
      }, 5000);

      pipelineEntries.push(entry);
      console.log(`scheduler: pipeline "${pipelineCfg.name}" — every ${intervalMin}m`);
    }
  }

  pruneOldItems();
  pruneTimer = setInterval(pruneOldItems, 24 * 60 * 60 * 1000);
}

async function runAdapter(entry: AdapterEntry): Promise<RefreshResult> {
  if (entry.running) return { kind: "adapter", name: entry.name, status: "skipped" };
  entry.running = true;

  const { name, adapter, adapterConfig } = entry;
  try {
    const items = await adapter.fetch(adapterConfig);
    if (items.length > 0) {
      saveItems(name, items);
      console.log(`scheduler: ${name} — fetched ${items.length} items`);
    }

    if (adapterConfig.transforms && adapterConfig.transforms.length > 0) {
      const allItems = getAllItemsByAdapter(name);
      const transformed = await runPipeline(allItems, adapterConfig.transforms, transformCtx);
      replaceAdapterItems(name, transformed);
      if (allItems.length !== transformed.length) {
        console.log(`scheduler: ${name} — transforms: ${allItems.length} → ${transformed.length} items`);
      }
    }
  } catch (err) {
    console.warn(`scheduler: ${name} — error:`, err);
    return { kind: "adapter", name, status: "failed", error: errorMessage(err) };
  } finally {
    entry.running = false;
  }

  return { kind: "adapter", name, status: "ok" };
}

async function runPipelineJob(entry: PipelineEntry): Promise<RefreshResult> {
  if (entry.running) return { kind: "pipeline", name: entry.config.name, status: "skipped" };
  entry.running = true;

  const { config } = entry;
  try {
    let items: ContentItemRow[] = [];
    for (const source of config.sources) {
      items = items.concat(getAllItemsByAdapter(source));
    }
    items.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));

    const transformed = await runPipeline(items, config.transforms, transformCtx);
    const namespaced = transformed.map((item) => ({
      ...item,
      id: `pipeline:${config.name}:${item.id}`,
    }));
    replaceAdapterItems(config.name, namespaced);
    console.log(`scheduler: pipeline "${config.name}" — ${items.length} → ${transformed.length} items`);
  } catch (err) {
    console.warn(`scheduler: pipeline "${config.name}" — error:`, err);
    return { kind: "pipeline", name: config.name, status: "failed", error: errorMessage(err) };
  } finally {
    entry.running = false;
  }

  return { kind: "pipeline", name: config.name, status: "ok" };
}

function pruneOldItems(): void {
  try {
    const db = getDb();
    const result = db.prepare(
      "DELETE FROM content_items WHERE fetched_at < datetime('now', '-30 days')"
    ).run();
    if (result.changes > 0) {
      console.log(`scheduler: pruned ${result.changes} items older than 30 days`);
    }
  } catch (err) {
    console.warn("scheduler: prune error:", err);
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
  }
  pipelineEntries.length = 0;
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
}
