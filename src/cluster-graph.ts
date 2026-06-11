import { unionFind } from "./dedupe";
import {
  computeClusterSimilarity,
  type ClusterItemSignals,
} from "./cluster-signals";
import type { ClusterStrategy } from "./config/types";

export interface SimilarityEdge {
  i: number;
  j: number;
  sim: number;
}

export interface ClusterGroup {
  indices: number[];
  label: string;
}

export function buildSimilarityGraph(
  itemCount: number,
  signals: ClusterItemSignals[],
  strategy: ClusterStrategy | "auto",
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

export function groupIndicesByUnionFind(
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

export function partitionClusters(
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