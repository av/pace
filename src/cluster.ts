import type { TransformConfig } from "./config/types";
import type { ContentItemRow } from "./db";
import { logTransformClusterSummary } from "./transform-warn";
import {
  buildSimilarityGraph,
  groupIndicesByUnionFind,
  partitionClusters,
} from "./cluster-graph";
import { buildClusterSignals } from "./cluster-signals";
import { buildAnnotatedClusterResult } from "./cluster-result";

export type ClusterTransformConfig = Extract<TransformConfig, { type: "cluster" }>;

export function applyCluster(
  items: ContentItemRow[],
  cfg: ClusterTransformConfig
): ContentItemRow[] {
  const strategy = cfg.strategy ?? "auto";
  const minClusterSize = cfg.min_cluster_size ?? 2;
  const maxClusters = cfg.max_clusters ?? 10;
  const similarityThreshold = cfg.similarity_threshold ?? 0.3;
  const annotate = cfg.annotate ?? true;

  if (items.length < 2) return items;

  const signals = buildClusterSignals(items);
  const similarities = buildSimilarityGraph(items.length, signals, strategy, similarityThreshold);
  const clusterMap = groupIndicesByUnionFind(items.length, similarities);
  const { clusters, unclustered } = partitionClusters(clusterMap, minClusterSize, maxClusters);
  const result = buildAnnotatedClusterResult(items, signals, clusters, unclustered, annotate);

  logTransformClusterSummary(strategy, clusters, unclustered.length);

  return result;
}