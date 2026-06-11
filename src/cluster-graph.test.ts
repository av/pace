import { describe, test, expect } from "bun:test";
import type { ClusterItemSignals } from "./cluster-signals";
import {
  buildSimilarityGraph,
  groupIndicesByUnionFind,
  partitionClusters,
} from "./cluster-graph";

function signal(overrides: Partial<ClusterItemSignals> = {}): ClusterItemSignals {
  return {
    domain: "",
    keywords: new Set(),
    source: "",
    ...overrides,
  };
}

describe("cluster-graph", () => {
  describe("buildSimilarityGraph", () => {
    test("includes edges at or above threshold and sorts by descending similarity", () => {
      const signals = [
        signal({ domain: "github.com" }),
        signal({ domain: "github.com" }),
        signal({ domain: "example.com" }),
      ];

      const edges = buildSimilarityGraph(signals.length, signals, "domain", 0.5);

      expect(edges).toEqual([{ i: 0, j: 1, sim: 1 }]);
    });

    test("returns empty graph when no pairs meet threshold", () => {
      const signals = [
        signal({ domain: "a.com" }),
        signal({ domain: "b.com" }),
      ];

      expect(buildSimilarityGraph(signals.length, signals, "domain", 0.5)).toEqual([]);
    });
  });

  describe("groupIndicesByUnionFind", () => {
    test("merges indices connected by similarity edges", () => {
      const clusterMap = groupIndicesByUnionFind(4, [
        { i: 0, j: 1, sim: 1 },
        { i: 2, j: 3, sim: 1 },
      ]);

      const groups = [...clusterMap.values()].map((indices) => [...indices].sort());
      expect(groups).toEqual([
        [0, 1],
        [2, 3],
      ]);
    });

    test("keeps singleton groups for disconnected indices", () => {
      const clusterMap = groupIndicesByUnionFind(3, [{ i: 0, j: 1, sim: 1 }]);

      const groups = [...clusterMap.values()].map((indices) => [...indices].sort());
      expect(groups).toEqual([
        [0, 1],
        [2],
      ]);
    });
  });

  describe("partitionClusters", () => {
    test("promotes groups meeting minClusterSize and demotes smaller groups", () => {
      const clusterMap = new Map<number, number[]>([
        [0, [0, 1]],
        [2, [2]],
      ]);

      const { clusters, unclustered } = partitionClusters(clusterMap, 2, 10);

      expect(clusters).toEqual([{ indices: [0, 1], label: "" }]);
      expect(unclustered).toEqual([2]);
    });

    test("caps cluster count and spills overflow indices into unclustered", () => {
      const clusterMap = new Map<number, number[]>([
        [0, [0, 1, 2]],
        [3, [3, 4]],
        [5, [5, 6]],
      ]);

      const { clusters, unclustered } = partitionClusters(clusterMap, 2, 2);

      expect(clusters).toHaveLength(2);
      expect(clusters[0].indices).toEqual([0, 1, 2]);
      expect(clusters[1].indices).toEqual([3, 4]);
      expect(unclustered.sort()).toEqual([5, 6]);
    });
  });
});