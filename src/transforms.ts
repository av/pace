import type { TransformConfig, TransformType } from "./config";
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

export type { TransformContext };

type TransformFn = (
  items: ContentItemRow[],
  config: TransformConfig,
  ctx: TransformContext
) => Promise<ContentItemRow[]>;

const transforms = {
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

  ...llmTransforms,
} satisfies Record<TransformType, TransformFn>;

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