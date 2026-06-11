import type { TransformConfig } from "./config/types";
import type { ContentItemRow } from "./db";
import { extractEngagementScore } from "./adapters/engagement";
import { unionFind } from "./dedupe";
import { logTransformClusterSummary } from "./transform-warn";
import { compareIsoTimestamp } from "./utils";
import { generateClusterLabel } from "./cluster-label";
import {
  buildClusterSignals,
  computeClusterSimilarity,
  type ClusterItemSignals,
} from "./cluster-signals";

export type ClusterTransformConfig = Extract<TransformConfig, { type: "cluster" }>;

interface SimilarityEdge {
  i: number;
  j: number;
  sim: number;
}

interface ClusterGroup {
  indices: number[];
  label: string;
}

function buildSimilarityGraph(
  itemCount: number,
  signals: ClusterItemSignals[],
  strategy: ClusterTransformConfig["strategy"] | "auto",
  similarityThreshold: number
): SimilarityEdge[] {
  const similarities: SimilarityEdge[] = [];
  for (let i = 0; i < itemCount; i++) {
    for (let j = i + 1; j < itemCount; j++) {
      const sim = computeClusterSimilarity(signals[i], signals[j], strategy);
      if (sim >= similarityThreshold) {
        similarities.push({ i, j, sim });
      }
    }
  }
  similarities.sort((a, b) => b.sim - a.sim);
  return similarities;
}

function groupIndicesByUnionFind(
  itemCount: number,
  similarities: SimilarityEdge[]
): Map<number, number[]> {
  const { find, union } = unionFind(itemCount);
  for (const { i, j } of similarities) {
    union(i, j);
  }

  const clusterMap = new Map<number, number[]>();
  for (let i = 0; i < itemCount; i++) {
    const root = find(i);
    const group = clusterMap.get(root) ?? [];
    group.push(i);
    clusterMap.set(root, group);
  }
  return clusterMap;
}

function partitionClusters(
  clusterMap: Map<number, number[]>,
  minClusterSize: number,
  maxClusters: number
): { clusters: ClusterGroup[]; unclustered: number[] } {
  const clusters: ClusterGroup[] = [];
  const unclustered: number[] = [];

  for (const [, indices] of clusterMap) {
    if (indices.length >= minClusterSize) {
      clusters.push({ indices, label: "" });
    } else {
      unclustered.push(...indices);
    }
  }

  clusters.sort((a, b) => b.indices.length - a.indices.length);
  if (clusters.length > maxClusters) {
    for (let i = maxClusters; i < clusters.length; i++) {
      unclustered.push(...clusters[i].indices);
    }
    clusters.splice(maxClusters);
  }

  return { clusters, unclustered };
}

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