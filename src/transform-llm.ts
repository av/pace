import type { Model, Api } from "@mariozechner/pi-ai";
import type { TransformConfig, LlmConfig } from "./config";
import type { ContentItemRow } from "./db";
import { contentRowToItem, contentItemToRow } from "./db";
import { summarizeItem, lensItems, mergeItems, filterItemsByLlm } from "./llm";
import { sortRowsByInputOrder } from "./transform-steps";

export interface TransformContext {
  llmModel: Model<Api> | null;
  llmConfig?: LlmConfig;
}

type LlmTransformFn = (
  items: ContentItemRow[],
  config: TransformConfig,
  ctx: TransformContext
) => Promise<ContentItemRow[]>;

async function summarizeRows(model: Model<Api>, items: ContentItemRow[]): Promise<ContentItemRow[]> {
  const results: ContentItemRow[] = [];
  for (const item of items) {
    if (item.summary) {
      results.push(item);
      continue;
    }
    const summary = await summarizeItem(model, contentRowToItem(item));
    results.push({ ...item, summary: summary ?? item.summary });
  }
  return results;
}

async function filterRows(
  model: Model<Api>,
  items: ContentItemRow[],
  criteria: string
): Promise<ContentItemRow[]> {
  const filtered = await filterItemsByLlm(model, items.map(contentRowToItem), criteria);
  const keepIds = new Set(filtered.map((i) => i.id));
  return items.filter((row) => keepIds.has(row.id));
}

async function rankRows(
  model: Model<Api>,
  items: ContentItemRow[],
  interests: string[]
): Promise<ContentItemRow[]> {
  if (interests.length === 0) return items;
  const ranked = await lensItems(model, items.map(contentRowToItem), interests);
  const rowById = new Map(items.map((r) => [r.id, r]));
  const order = ranked.flatMap((item) => {
    const row = rowById.get(item.id);
    return row ? [row] : [];
  });
  return sortRowsByInputOrder(items, order);
}

async function mergeRows(
  model: Model<Api>,
  items: ContentItemRow[],
  prompt?: string
): Promise<ContentItemRow[]> {
  const merged = await mergeItems(model, items.map(contentRowToItem), prompt);
  const rowMap = new Map<string, ContentItemRow>();
  for (const row of items) rowMap.set(row.id, row);
  return merged.map((item) => {
    const baseRow = rowMap.get(item.id) ?? rowMap.get(item.id.split("+")[0]);
    return contentItemToRow(item, baseRow);
  });
}

export const llmTransforms: Record<string, LlmTransformFn> = {
  "llm-summarize": (items, _config, ctx) =>
    ctx.llmModel ? summarizeRows(ctx.llmModel, items) : Promise.resolve(items),

  "llm-filter": (items, config, ctx) =>
    ctx.llmModel
      ? filterRows(ctx.llmModel, items, (config as Extract<TransformConfig, { type: "llm-filter" }>).criteria)
      : Promise.resolve(items),

  "llm-rank": (items, config, ctx) => {
    if (!ctx.llmModel) return Promise.resolve(items);
    const cfg = config as Extract<TransformConfig, { type: "llm-rank" }>;
    const interests = cfg.interests ?? ctx.llmConfig?.interests ?? [];
    return rankRows(ctx.llmModel, items, interests);
  },

  "llm-merge": (items, config, ctx) =>
    ctx.llmModel
      ? mergeRows(ctx.llmModel, items, (config as Extract<TransformConfig, { type: "llm-merge" }>).prompt)
      : Promise.resolve(items),
};