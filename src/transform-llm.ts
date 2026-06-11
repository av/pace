import type { Model, Api } from "@mariozechner/pi-ai";
import type { ContentItem } from "./adapters/types";
import type { LlmConfig, TransformConfig, TransformType } from "./config/types";
import {
  type ContentItemRow,
  contentRowsToItems,
  contentRowMapById,
  filterRowsByItemIds,
  contentItemsToRows,
} from "./db";
import { sortByInputOrder } from "./dedupe";
import { summarizeItems, lensItems, mergeItems, filterItemsByLlm } from "./llm";

export interface TransformContext {
  llmModel: Model<Api> | null;
  llmConfig?: LlmConfig;
}

type LlmTransformFn = (
  items: ContentItemRow[],
  config: TransformConfig,
  ctx: TransformContext
) => Promise<ContentItemRow[]>;

function withLlmModel(
  items: ContentItemRow[],
  ctx: TransformContext,
  run: (model: Model<Api>, items: ContentItemRow[]) => Promise<ContentItemRow[]>,
): Promise<ContentItemRow[]> {
  return ctx.llmModel ? run(ctx.llmModel, items) : Promise.resolve(items);
}

async function mapRowsThroughLlm(
  model: Model<Api>,
  rows: ContentItemRow[],
  llmFn: (model: Model<Api>, items: ContentItem[]) => Promise<ContentItem[]>,
  mapBack: (llmItems: ContentItem[], rows: ContentItemRow[]) => ContentItemRow[],
): Promise<ContentItemRow[]> {
  const llmItems = await llmFn(model, contentRowsToItems(rows));
  return mapBack(llmItems, rows);
}

function applySummariesToRows(
  llmItems: ContentItem[],
  rows: ContentItemRow[],
): ContentItemRow[] {
  const summaryById = new Map(
    llmItems
      .filter((item): item is ContentItem & { summary: string } => !!item.summary)
      .map((item) => [item.id, item.summary]),
  );
  return rows.map((row) => {
    const summary = summaryById.get(row.id);
    return summary ? { ...row, summary } : row;
  });
}

async function summarizeRows(model: Model<Api>, items: ContentItemRow[]): Promise<ContentItemRow[]> {
  const pending = items.filter((row) => !row.summary);
  if (pending.length === 0) return items;

  const updated = await mapRowsThroughLlm(
    model,
    pending,
    (m, contentItems) => summarizeItems(m, contentItems),
    (llmItems, rows) => applySummariesToRows(llmItems, rows),
  );

  const updatedById = contentRowMapById(updated);
  return items.map((row) => updatedById.get(row.id) ?? row);
}

function rowsInItemOrder(rows: ContentItemRow[], orderedItems: { id: string }[]): ContentItemRow[] {
  const rowById = contentRowMapById(rows);
  const order = orderedItems.flatMap((item) => {
    const row = rowById.get(item.id);
    return row ? [row] : [];
  });
  return sortByInputOrder(rows, order);
}

async function filterRows(
  model: Model<Api>,
  items: ContentItemRow[],
  criteria: string
): Promise<ContentItemRow[]> {
  return mapRowsThroughLlm(
    model,
    items,
    (m, contentItems) => filterItemsByLlm(m, contentItems, criteria),
    (filtered, rows) => filterRowsByItemIds(rows, filtered),
  );
}

async function rankRows(
  model: Model<Api>,
  items: ContentItemRow[],
  interests: string[]
): Promise<ContentItemRow[]> {
  return mapRowsThroughLlm(
    model,
    items,
    (m, contentItems) => lensItems(m, contentItems, interests),
    (ranked, rows) => rowsInItemOrder(rows, ranked),
  );
}

async function mergeRows(
  model: Model<Api>,
  items: ContentItemRow[],
  prompt?: string
): Promise<ContentItemRow[]> {
  const rowById = contentRowMapById(items);
  return mapRowsThroughLlm(
    model,
    items,
    (m, contentItems) => mergeItems(m, contentItems, prompt),
    (merged) => contentItemsToRows(merged, rowById),
  );
}

type LlmTransformType = Extract<TransformType, `llm-${string}`>;

export const llmTransforms = {
  "llm-summarize": (items, _config, ctx) =>
    withLlmModel(items, ctx, (model, rows) => summarizeRows(model, rows)),

  "llm-filter": (items, config, ctx) =>
    withLlmModel(items, ctx, (model, rows) =>
      filterRows(model, rows, (config as Extract<TransformConfig, { type: "llm-filter" }>).criteria)),

  "llm-rank": (items, config, ctx) =>
    withLlmModel(items, ctx, (model, rows) => {
      const cfg = config as Extract<TransformConfig, { type: "llm-rank" }>;
      const interests = cfg.interests ?? ctx.llmConfig?.interests ?? [];
      return rankRows(model, rows, interests);
    }),

  "llm-merge": (items, config, ctx) =>
    withLlmModel(items, ctx, (model, rows) =>
      mergeRows(model, rows, (config as Extract<TransformConfig, { type: "llm-merge" }>).prompt)),
} satisfies Record<LlmTransformType, LlmTransformFn>;