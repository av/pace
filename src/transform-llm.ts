import type { Model, Api } from "@mariozechner/pi-ai";
import type { TransformConfig, LlmConfig } from "./config";
import type { ContentItemRow } from "./db";
import type { ContentItem } from "./adapters/types";
import { summarizeItem, lensItems, mergeItems, filterItemsByLlm } from "./llm";
import { sortRowsByInputOrder } from "./transform-steps";

export interface TransformContext {
  llmModel: Model<Api> | null;
  llmConfig?: LlmConfig;
}

export type LlmSummarizeTransformConfig = Extract<TransformConfig, { type: "llm-summarize" }>;
export type LlmFilterTransformConfig = Extract<TransformConfig, { type: "llm-filter" }>;
export type LlmRankTransformConfig = Extract<TransformConfig, { type: "llm-rank" }>;
export type LlmMergeTransformConfig = Extract<TransformConfig, { type: "llm-merge" }>;

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

function withLlmModel<T extends ContentItemRow>(
  ctx: TransformContext,
  items: T[],
  work: (model: NonNullable<TransformContext["llmModel"]>) => Promise<T[]>
): Promise<T[]> {
  if (!ctx.llmModel) return Promise.resolve(items);
  return work(ctx.llmModel);
}

export async function applyLlmSummarize(
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

export async function applyLlmFilter(
  model: Model<Api>,
  items: ContentItemRow[],
  { criteria }: LlmFilterTransformConfig
): Promise<ContentItemRow[]> {
  const filtered = await filterItemsByLlm(model, items.map(rowToContentItem), criteria);
  const keepIds = new Set(filtered.map((i) => i.id));
  return items.filter((row) => keepIds.has(row.id));
}

export async function applyLlmRank(
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

export async function applyLlmMerge(
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

type LlmTransformFn = (
  items: ContentItemRow[],
  config: TransformConfig,
  ctx: TransformContext
) => Promise<ContentItemRow[]>;

export const llmTransforms: Record<string, LlmTransformFn> = {
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