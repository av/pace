import type { TransformConfig, TransformType } from "./config/types";
import type { ContentItemRow } from "./db";
import { applyCluster } from "./cluster";
import {
  applyDedupe,
  applyFilter,
  applyExclude,
  applyLatest,
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
import { llmTransforms, type TransformContext } from "./transform-llm";
import { warnUnknownTransformType } from "./transform-warn";

export type { TransformContext };

type TransformFn = (
  items: ContentItemRow[],
  config: TransformConfig,
  ctx: TransformContext
) => ContentItemRow[] | Promise<ContentItemRow[]>;

export const TRANSFORM_RUNNERS = {
  latest: (items, config) => applyLatest(items, config as LatestTransformConfig),

  filter: (items, config) => applyFilter(items, config as FilterTransformConfig),

  exclude: (items, config) => applyExclude(items, config as ExcludeTransformConfig),

  sort: (items, config) => applySort(items, config as SortTransformConfig),

  dedupe: (items, config) => applyDedupe(items, config as DedupeTransformConfig),

  "keyword-score": (items, config) =>
    applyKeywordScore(items, config as KeywordScoreTransformConfig),

  "time-decay": (items, config) => applyTimeDecay(items, config as TimeDecayTransformConfig),

  cluster: (items, config) =>
    applyCluster(items, config as Extract<TransformConfig, { type: "cluster" }>),

  ...llmTransforms,
} satisfies Record<TransformType, TransformFn>;

function appendAppliedTransform(items: ContentItemRow[], type: string): ContentItemRow[] {
  return items.map((item) => {
    const existing: string[] = item.applied_transforms ? JSON.parse(item.applied_transforms) : [];
    if (existing.includes(type)) return item;
    return { ...item, applied_transforms: JSON.stringify([...existing, type]) };
  });
}

export async function runPipeline(
  items: ContentItemRow[],
  pipeline: TransformConfig[],
  ctx: TransformContext
): Promise<ContentItemRow[]> {
  let result = items;
  for (const step of pipeline) {
    const fn = TRANSFORM_RUNNERS[step.type];
    if (!fn) {
      warnUnknownTransformType(step.type);
      continue;
    }
    // Passthrough paths (null LLM model, skipped/errored LLM batches) return
    // the input array by reference; do not stamp provenance for those.
    const next = await Promise.resolve(fn(result, step, ctx));
    result = next !== result ? appendAppliedTransform(next, step.type) : next;
  }
  return result;
}