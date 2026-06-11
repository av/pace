import type { TransformConfig } from "./config/types";
import type { ContentItemRow } from "./db";
import { extractEngagementScore, stripEngagementMetricCounts } from "./adapters/engagement";
import { extractHostname, jaccardSimilarity, unionFind } from "./dedupe";
import { logTransformClusterSummary } from "./transform-warn";
import { compareIsoTimestamp } from "./utils";

export const CLUSTER_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "its", "this", "that", "are",
  "was", "were", "be", "been", "has", "have", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can", "shall",
  "not", "no", "nor", "so", "if", "then", "than", "too", "very", "just",
  "about", "up", "out", "how", "what", "when", "where", "who", "which",
  "why", "all", "each", "every", "both", "few", "more", "most", "other",
  "some", "such", "only", "own", "same", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "over", "again",
  "new", "now", "get", "got", "use", "using", "used", "via", "also",
  "one", "two", "first", "like", "still", "even", "much", "well", "back",
  "here", "there", "while", "yet", "these", "those", "them", "they",
  "your", "you", "my", "we", "our", "his", "her", "their", "i", "me",
  "him", "she", "he", "us", "whom",
  "points", "point", "comments", "comment", "discuss", "discussion",
  "stars", "star", "likes", "views", "view", "votes", "vote",
  "upvotes", "upvote", "boosts", "boost", "favorites", "favourite",
  "reactions", "reaction", "replies", "reply", "https", "http", "www",
  "com", "org", "net", "reddit", "github", "show", "item", "news",
  "ycombinator", "lobste", "read", "min", "cover",
]);

const CLUSTER_DOMAIN_LABELS: Record<string, string> = {
  "github.com": "GitHub",
  "reddit.com": "Reddit",
  "news.ycombinator.com": "Hacker News",
  "lobste.rs": "Lobsters",
  "arxiv.org": "ArXiv Papers",
  "stackoverflow.com": "Stack Overflow",
  "dev.to": "Dev.to",
  "youtube.com": "YouTube",
  "medium.com": "Medium",
  "twitter.com": "Twitter/X",
  "x.com": "Twitter/X",
};

interface ClusterItemSignals {
  domain: string;
  keywords: Set<string>;
  source: string;
}

export type ClusterTransformConfig = Extract<TransformConfig, { type: "cluster" }>;

function formatClusterDomainLabel(domain: string): string {
  const mapped = CLUSTER_DOMAIN_LABELS[domain];
  if (mapped) return mapped;
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function tallyCounts(
  indices: number[],
  getKeys: (idx: number) => Iterable<string | undefined>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const idx of indices) {
    for (const key of getKeys(idx)) {
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function getMajorityClusterLabel<T extends string>(
  counts: Map<T, number>,
  total: number,
  format?: (key: T) => string
): string | undefined {
  if (counts.size === 0) return undefined;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top[1] >= total * 0.6) {
    const key = top[0];
    return format ? format(key) : key;
  }
  return undefined;
}

function getTopKeywordsClusterLabel(counts: Map<string, number>, total: number): string | undefined {
  const minCount = Math.ceil(total * 0.4);
  const top = [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([kw]) => kw);
  if (top.length === 0) return undefined;
  return top.map((kw) => kw.charAt(0).toUpperCase() + kw.slice(1)).join("/");
}

function generateClusterLabel(
  indices: number[],
  signals: ClusterItemSignals[],
  clusterCount: number
): string {
  const domainLabel = getMajorityClusterLabel(
    tallyCounts(indices, (idx) => [signals[idx].domain]),
    indices.length,
    formatClusterDomainLabel
  );
  if (domainLabel) return domainLabel;

  const kwLabel = getTopKeywordsClusterLabel(
    tallyCounts(indices, (idx) => signals[idx].keywords),
    indices.length
  );
  if (kwLabel) return kwLabel;

  const sourceLabel = getMajorityClusterLabel(
    tallyCounts(indices, (idx) => [signals[idx].source]),
    indices.length
  );
  if (sourceLabel) return sourceLabel;

  return `Cluster ${clusterCount + 1}`;
}

function extractClusterKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !CLUSTER_STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function buildClusterSignals(items: ContentItemRow[]): ClusterItemSignals[] {
  return items.map((item) => {
    const titleKeywords = extractClusterKeywords(item.title ?? "");
    const body = item.body ?? "";
    const bodyClean = stripEngagementMetricCounts(body)
      .replace(/https?:\/\/[^\s|]+/g, "")
      .replace(/\bby\s+\S+/g, "")
      .replace(/\btags?:\s*[^\n|]+/gi, "")
      .replace(/\bdiscuss:/gi, "")
      .replace(/[|]/g, " ");
    const bodyKeywords = extractClusterKeywords(bodyClean.slice(0, 150));
    const allKeywords = new Set([...titleKeywords, ...bodyKeywords]);

    return {
      domain: extractHostname(item.url, "transforms"),
      keywords: allKeywords,
      source: item.source ?? item.panel_id ?? "",
    };
  });
}

function domainSimilarity(a: ClusterItemSignals, b: ClusterItemSignals): number {
  if (!a.domain || !b.domain) return 0;
  if (a.domain === b.domain) return 1.0;
  const aParts = a.domain.split(".");
  const bParts = b.domain.split(".");
  const aBase = aParts.slice(-2).join(".");
  const bBase = bParts.slice(-2).join(".");
  if (aBase === bBase) return 0.7;
  return 0;
}

function sourceSimilarity(a: ClusterItemSignals, b: ClusterItemSignals): number {
  return !a.source || !b.source ? 0 : a.source === b.source ? 1.0 : 0;
}

function computeClusterSimilarity(
  a: ClusterItemSignals,
  b: ClusterItemSignals,
  strategy: ClusterTransformConfig["strategy"] | "auto"
): number {
  switch (strategy) {
    case "domain":
      return domainSimilarity(a, b);
    case "keywords":
      return jaccardSimilarity(a.keywords, b.keywords);
    case "source":
      return sourceSimilarity(a, b);
    case "auto":
    default: {
      const domain = domainSimilarity(a, b) * 0.5;
      const keywords = jaccardSimilarity(a.keywords, b.keywords) * 0.45;
      const source = sourceSimilarity(a, b) * 0.05;
      return domain + keywords + source;
    }
  }
}

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