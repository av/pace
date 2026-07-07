import type { ContentItemRow } from "./db";
import { stripEngagementMetricCounts } from "./adapters/engagement";
import { extractHostname, jaccardSimilarity } from "./dedupe";
import type { ClusterStrategy } from "./config/types";

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

/**
 * Strips leading `[Label] ` annotation prefixes previously added by the
 * cluster transform (buildAnnotatedClusterResult). Transforms re-run over
 * already-transformed panel items, so without this the annotation would
 * accumulate (`[X] [X] body`) and stale label words would pollute the
 * keyword signals of subsequent clustering runs.
 */
export function stripClusterAnnotationPrefixes(body: string): string {
  return body.replace(/^(?:\s*\[[^\][\n]{1,80}\]\s+)+/, "");
}

export interface ClusterItemSignals {
  domain: string;
  keywords: Set<string>;
  source: string;
}

function extractClusterKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !CLUSTER_STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

export function buildClusterSignals(items: ContentItemRow[]): ClusterItemSignals[] {
  return items.map((item) => {
    const titleKeywords = extractClusterKeywords(item.title ?? "");
    const body = item.body ?? "";
    const bodyClean = stripEngagementMetricCounts(stripClusterAnnotationPrefixes(body))
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

/**
 * Shortlist of common two-label public suffixes (ccTLD second-level
 * registrations). Without this, the registrable domain of `bbc.co.uk` would
 * be computed as `co.uk`, making every `*.co.uk` site a 0.7 domain match and
 * falsely clustering unrelated publishers. Not the full public suffix list —
 * just the suffixes most likely to appear in feed URLs.
 */
const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  // United Kingdom
  "co.uk", "org.uk", "ac.uk", "gov.uk", "net.uk", "me.uk", "ltd.uk", "plc.uk",
  // Japan
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "ad.jp",
  // Australia
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au", "asn.au",
  // New Zealand
  "co.nz", "org.nz", "net.nz", "ac.nz", "govt.nz", "geek.nz",
  // India
  "co.in", "net.in", "org.in", "gen.in", "firm.in", "ac.in", "gov.in",
  // Brazil
  "com.br", "net.br", "org.br", "gov.br", "edu.br",
  // China / Taiwan / Hong Kong
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn",
  "com.tw", "org.tw", "gov.tw", "edu.tw",
  "com.hk", "org.hk", "edu.hk", "gov.hk",
  // Korea
  "co.kr", "or.kr", "go.kr", "ne.kr", "ac.kr",
  // South Africa
  "co.za", "org.za", "gov.za", "web.za", "ac.za",
  // Mexico / Argentina
  "com.mx", "org.mx", "gob.mx", "edu.mx",
  "com.ar", "org.ar", "gob.ar", "edu.ar",
  // Singapore / Malaysia / Indonesia
  "com.sg", "org.sg", "edu.sg", "gov.sg",
  "com.my", "org.my", "gov.my", "edu.my",
  "co.id", "or.id", "go.id", "ac.id",
  // Turkey / Ukraine / Poland
  "com.tr", "org.tr", "gov.tr", "edu.tr",
  "com.ua", "org.ua", "in.ua", "gov.ua",
  "com.pl", "net.pl", "org.pl", "edu.pl",
]);

/**
 * Best-effort registrable domain ("site" identity) for clustering: the label
 * directly below the public suffix, using the shortlist above for two-label
 * ccTLD suffixes and the plain TLD otherwise.
 */
export function registrableDomain(domain: string): string {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

function domainSimilarity(a: ClusterItemSignals, b: ClusterItemSignals): number {
  if (!a.domain || !b.domain) return 0;
  if (a.domain === b.domain) return 1.0;
  if (registrableDomain(a.domain) === registrableDomain(b.domain)) return 0.7;
  return 0;
}

function sourceSimilarity(a: ClusterItemSignals, b: ClusterItemSignals): number {
  return !a.source || !b.source ? 0 : a.source === b.source ? 1.0 : 0;
}

export function computeClusterSimilarity(
  a: ClusterItemSignals,
  b: ClusterItemSignals,
  strategy: ClusterStrategy | "auto"
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