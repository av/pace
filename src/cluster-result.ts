import type { ContentItemRow } from "./db";
import { extractEngagementScore } from "./adapters/engagement";
import { compareIsoTimestamp } from "./utils";
import { generateClusterLabel } from "./cluster-label";
import type { ClusterGroup } from "./cluster-graph";
import type { ClusterItemSignals } from "./cluster-signals";

export function buildAnnotatedClusterResult(
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