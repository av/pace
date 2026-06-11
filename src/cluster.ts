import type { TransformConfig } from "./config/types";
import type { ContentItemRow } from "./db";
import { extractEngagementScore } from "./adapters/engagement";
import { logTransformClusterSummary } from "./transform-warn";
import { compareIsoTimestamp } from "./utils";
import { generateClusterLabel } from "./cluster-label";
import {
  buildSimilarityGraph,
  groupIndicesByUnionFind,
  partitionClusters,
  type ClusterGroup,
} from "./cluster-graph";
import { buildClusterSignals, type ClusterItemSignals } from "./cluster-signals";

export type ClusterTransformConfig = Extract<TransformConfig, { type: "cluster" }>;

function buildAnnotatedClusterResult(
  items: ContentItemRow[],
  signals: ClusterItemSignals[],
  clusters: ClusterGroup[],
  unclustered: number[],
  annotate: boolean
): ContentItemRow[] {
  const result: ContentItemRow[] = [];

  for (const cluster of clusters) {
    cluster.label = generateClusterLabel(cluster.indices, signals, clusters.length);
    cluster.indices.sort(
      (a, b) => extractEngagementScore(items[b].body) - extractEngagementScore(items[a].body)
    );
    for (const idx of cluster.indices) {
      const item = items[idx];
      result.push(
        annotate ? { ...item, body: `[${cluster.label}] ${item.body ?? ""}` } : item
      );
    }
  }

  unclustered.sort((a, b) =>
    compareIsoTimestamp(items[a].timestamp, items[b].timestamp, "desc")
  );
  for (const idx of unclustered) {
    result.push(items[idx]);
  }

  return result;
}

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