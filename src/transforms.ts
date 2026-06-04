import type { Model, Api } from "@mariozechner/pi-ai";
import type { TransformConfig, LlmConfig } from "./config";
import type { ContentItemRow } from "./db";
import type { ContentItem } from "./adapters/types";
import { summarizeItem, lensItems, mergeItems, filterItemsByLlm } from "./llm";
import { applyCluster } from "./cluster";
import {
  applyDedupe,
  applyFilter,
  applyExclude,
  applyLatest,
  sortRowsByInputOrder,
  type LatestTransformConfig,
  type FilterTransformConfig,
  type ExcludeTransformConfig,
  type DedupeTransformConfig,
} from "./transform-steps";
import {
  applySort,
  applyKeywordScore,
  applyTimeDecay,
  type SortTransformConfig,
  type KeywordScoreTransformConfig,
  type TimeDecayTransformConfig,
} from "./transform-rank";

export interface TransformContext {
  llmModel: Model<Api> | null;
  llmConfig?: LlmConfig;
}

function rowToContentItem(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    timestamp: new Date(row.timestamp),
    body: row.body ?? undefined,
  };
}

function contentItemToRow(item: ContentItem, base?: ContentItemRow): ContentItemRow {
  return {
    id: item.id,
    panel_id: base?.panel_id ?? "merged",
    title: item.title,
    url: item.url,
    source: item.source,
    body: item.body ?? null,
    timestamp: item.timestamp.toISOString(),
    fetched_at: base?.fetched_at ?? new Date().toISOString(),
    summary: base?.summary ?? (item.body ?? null),
  };
}

type LlmSummarizeTransformConfig = Extract<TransformConfig, { type: "llm-summarize" }>;
type LlmFilterTransformConfig = Extract<TransformConfig, { type: "llm-filter" }>;
type LlmRankTransformConfig = Extract<TransformConfig, { type: "llm-rank" }>;
type LlmMergeTransformConfig = Extract<TransformConfig, { type: "llm-merge" }>;

function withLlmModel<T extends ContentItemRow>(
  ctx: TransformContext,
  items: T[],
  work: (model: NonNullable<TransformContext["llmModel"]>) => Promise<T[]>
): Promise<T[]> {
  if (!ctx.llmModel) return Promise.resolve(items);
  return work(ctx.llmModel);
}

async function applyLlmSummarize(
  model: Model<Api>,
  items: ContentItemRow[],
  _config: LlmSummarizeTransformConfig
): Promise<ContentItemRow[]> {
  const results: ContentItemRow[] = [];
  for (const item of items) {
    if (item.summary) {
      results.push(item);
      continue;
    }
    const summary = await summarizeItem(model, rowToContentItem(item));
    results.push({ ...item, summary: summary ?? item.summary });
  }
  return results;
}

async function applyLlmFilter(
  model: Model<Api>,
  items: ContentItemRow[],
  { criteria }: LlmFilterTransformConfig
): Promise<ContentItemRow[]> {
  const filtered = await filterItemsByLlm(model, items.map(rowToContentItem), criteria);
  const keepIds = new Set(filtered.map((i) => i.id));
  return items.filter((row) => keepIds.has(row.id));
}

async function applyLlmRank(
  model: Model<Api>,
  items: ContentItemRow[],
  config: LlmRankTransformConfig,
  ctx: TransformContext
): Promise<ContentItemRow[]> {
  const effectiveInterests = config.interests ?? ctx.llmConfig?.interests ?? [];
  if (effectiveInterests.length === 0) return items;
  const ranked = await lensItems(model, items.map(rowToContentItem), effectiveInterests);
  const rowById = new Map(items.map((r) => [r.id, r]));
  const order = ranked.flatMap((item) => {
    const row = rowById.get(item.id);
    return row ? [row] : [];
  });
  return sortRowsByInputOrder(items, order);
}

async function applyLlmMerge(
  model: Model<Api>,
  items: ContentItemRow[],
  { prompt }: LlmMergeTransformConfig
): Promise<ContentItemRow[]> {
  const merged = await mergeItems(model, items.map(rowToContentItem), prompt);
  const rowMap = new Map<string, ContentItemRow>();
  for (const row of items) rowMap.set(row.id, row);
  return merged.map((item) => {
    const baseRow = rowMap.get(item.id) ?? rowMap.get(item.id.split("+")[0]);
    return contentItemToRow(item, baseRow);
  });
}

type TransformFn = (
  items: ContentItemRow[],
  config: TransformConfig,
  ctx: TransformContext
) => Promise<ContentItemRow[]>;

const transforms: Record<string, TransformFn> = {
  latest: async (items, config) => applyLatest(items, config as LatestTransformConfig),

  filter: async (items, config) => applyFilter(items, config as FilterTransformConfig),

  exclude: async (items, config) => applyExclude(items, config as ExcludeTransformConfig),

  sort: async (items, config) => applySort(items, config as SortTransformConfig),

  dedupe: async (items, config) => applyDedupe(items, config as DedupeTransformConfig),

  "keyword-score": async (items, config) =>
    applyKeywordScore(items, config as KeywordScoreTransformConfig),

  "time-decay": async (items, config) => applyTimeDecay(items, config as TimeDecayTransformConfig),

  cluster: async (items, config) =>
    applyCluster(items, config as Extract<TransformConfig, { type: "cluster" }>),

  "llm-summarize": (items, config, ctx) =>
    withLlmModel(ctx, items, (model) =>
      applyLlmSummarize(model, items, config as LlmSummarizeTransformConfig)),

  "llm-filter": (items, config, ctx) =>
    withLlmModel(ctx, items, (model) =>
      applyLlmFilter(model, items, config as LlmFilterTransformConfig)),

  "llm-rank": (items, config, ctx) =>
    withLlmModel(ctx, items, (model) =>
      applyLlmRank(model, items, config as LlmRankTransformConfig, ctx)),

  "llm-merge": (items, config, ctx) =>
    withLlmModel(ctx, items, (model) =>
      applyLlmMerge(model, items, config as LlmMergeTransformConfig)),
};

export async function runPipeline(
  items: ContentItemRow[],
  pipeline: TransformConfig[],
  ctx: TransformContext
): Promise<ContentItemRow[]> {
  let result = items;
  for (const step of pipeline) {
    const fn = transforms[step.type];
    if (!fn) {
      console.warn(`transforms: unknown transform type "${step.type}", skipping`);
      continue;
    }
    result = await fn(result, step, ctx);
  }
  return result;
}