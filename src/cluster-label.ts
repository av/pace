import type { ClusterItemSignals } from "./cluster-signals";

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

export function generateClusterLabel(
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