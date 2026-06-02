import type { Model, Api } from "@mariozechner/pi-ai";
import type { TransformConfig, LlmConfig, KeywordScoreEntry, KeywordField } from "./config";
import type { ContentItemRow } from "./db";
import type { ContentItem } from "./adapters/types";
import { summarizeItem, lensItems, mergeItems, filterItemsByLlm } from "./llm";
import { extractEngagementScore } from "./adapters/engagement";
import {
  normalizeUrl,
  levenshteinSimilarity,
  extractScore,
  type DedupeStrategy,
} from "./dedupe";

export { extractEngagementScore };
import { compareIsoTimestamp, errorMessage } from "./utils";

export interface TransformContext {
  llmModel: Model<Api> | null;
  llmConfig?: LlmConfig;
}

function rowToContentItem(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    timestamp: new Date(row.timestamp),
    body: row.body ?? undefined,
  };
}

function contentItemToRow(item: ContentItem, base?: ContentItemRow): ContentItemRow {
  return {
    id: item.id,
    panel_id: base?.panel_id ?? "merged",
    title: item.title,
    url: item.url,
    source: item.source,
    body: item.body ?? null,
    timestamp: item.timestamp.toISOString(),
    fetched_at: base?.fetched_at ?? new Date().toISOString(),
    summary: base?.summary ?? (item.body ?? null),
  };
}

function toContentItems(items: ContentItemRow[]): ContentItem[] {
  return items.map(rowToContentItem);
}

function pickByTimestamp(group: ContentItemRow[], direction: "asc" | "desc"): ContentItemRow {
  return group.reduce((a, b) =>
    compareIsoTimestamp(a.timestamp, b.timestamp, direction) <= 0 ? a : b
  );
}

type DedupeKeep = "highest-score" | "earliest" | "latest";

function pickWinner(group: ContentItemRow[], keep: DedupeKeep): ContentItemRow {
  if (group.length === 1) return group[0];
  if (keep === "earliest" || keep === "latest") {
    return pickByTimestamp(group, keep === "earliest" ? "asc" : "desc");
  }
  const best = group.reduce((a, b) =>
    extractScore(b.body) > extractScore(a.body) ? b : a
  );
  return extractScore(best.body) === 0 ? pickByTimestamp(group, "asc") : best;
}

function titleSimilarity(
  a: string | null | undefined,
  b: string | null | undefined
): number | null {
  const ta = a?.trim();
  const tb = b?.trim();
  if (!ta || !tb) return null;
  return levenshteinSimilarity(ta.toLowerCase(), tb.toLowerCase());
}

function pushToGroup<K>(groups: Map<K, ContentItemRow[]>, key: K, item: ContentItemRow): void {
  const group = groups.get(key);
  if (group) group.push(item);
  else groups.set(key, [item]);
}

function collectLosers(
  group: ContentItemRow[],
  winner: ContentItemRow,
  format: (loser: ContentItemRow, winner: ContentItemRow) => string
): string[] {
  return group
    .filter((item) => item !== winner)
    .map((item) => format(item, winner));
}

function parseHalfLife(str: string): number {
  const match = str.trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day|w|wk)s?$/i);
  if (!match) {
    console.warn(`[time-decay] invalid half_life "${str}", defaulting to 12h`);
    return 12 * 60 * 60 * 1000;
  }
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const MS_MINUTE = 60 * 1000;
  const MS_HOUR = 60 * MS_MINUTE;
  const MS_DAY = 24 * MS_HOUR;
  const MS_WEEK = 7 * MS_DAY;
  switch (unit) {
    case "m":
    case "min":
      return value * MS_MINUTE;
    case "h":
    case "hr":
      return value * MS_HOUR;
    case "d":
    case "day":
      return value * MS_DAY;
    case "w":
    case "wk":
      return value * MS_WEEK;
    default:
      return value * MS_HOUR;
  }
}

function filterByMinScore<T extends { score?: number; finalScore?: number }>(
  scored: T[],
  minScore: number | undefined,
  getScore: (s: T) => number,
  label: string
): T[] {
  if (minScore === undefined) return scored;
  const before = scored.length;
  const filtered = scored.filter((s) => getScore(s) >= minScore);
  if (filtered.length < before) {
    console.log(
      `[${label}] filtered out ${before - filtered.length} item(s) below min_score=${minScore}`
    );
  }
  return filtered;
}

function annotateRow<T extends { body?: string }>(row: T, annotation: string | undefined): T {
  if (!annotation) return row;
  return { ...row, body: (row.body ?? "") + annotation } as T;
}

function sortByScoreDesc<T>(arr: T[], getScore: (x: T) => number): void {
  arr.sort((a, b) => getScore(b) - getScore(a));
}

function keywordFieldValue(item: ContentItemRow, field: KeywordField): string | null {
  switch (field) {
    case "title":
      return item.title;
    case "body":
      return item.body;
    case "source":
      return item.source;
  }
}

function matchesAnyKeyword(
  item: ContentItemRow,
  lowerKeywords: string[],
  checkFields: readonly KeywordField[]
): boolean {
  return lowerKeywords.some((kw) =>
    checkFields.some((f) => {
      const val = keywordFieldValue(item, f);
      return val ? val.toLowerCase().includes(kw) : false;
    })
  );
}

function makeKeywordPredicate(
  keywords: string[],
  fields?: readonly KeywordField[]
): (item: ContentItemRow) => boolean {
  const checkFields = fields ?? ["title", "body"];
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return (item) => matchesAnyKeyword(item, lowerKeywords, checkFields);
}

type KeywordMatchConfig = Extract<TransformConfig, { type: "filter" } | { type: "exclude" }>;

function filterByKeywordMatch(
  items: ContentItemRow[],
  { keywords, fields }: Pick<KeywordMatchConfig, "keywords" | "fields">,
  keepMatches: boolean
): ContentItemRow[] {
  const predicate = makeKeywordPredicate(keywords, fields);
  return items.filter((item) => keepMatches === predicate(item));
}

function topMapEntry<T>(counts: Map<T, number>): [T, number] | undefined {
  if (counts.size === 0) return undefined;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const kw of a) {
    if (b.has(kw)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

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

function formatClusterDomainLabel(domain: string): string {
  const mapped = CLUSTER_DOMAIN_LABELS[domain];
  if (mapped) return mapped;
  const base = domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function getMajorityClusterLabel<T extends string>(
  counts: Map<T, number>,
  total: number,
  format?: (key: T) => string
): string | undefined {
  const top = topMapEntry(counts);
  if (top && top[1] >= total * 0.6) {
    const key = top[0];
    return format ? format(key) : key;
  }
  return undefined;
}

function tallyFromIndices(
  counts: Map<string, number>,
  indices: number[],
  getKeys: (idx: number) => Iterable<string | undefined>
): void {
  for (const idx of indices) {
    for (const key of getKeys(idx)) {
      if (key) incrementCount(counts, key);
    }
  }
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
  const domainCounts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();

  tallyFromIndices(domainCounts, indices, (idx) => [signals[idx].domain]);
  tallyFromIndices(keywordCounts, indices, (idx) => signals[idx].keywords);

  const domainLabel = getMajorityClusterLabel(domainCounts, indices.length, formatClusterDomainLabel);
  if (domainLabel) return domainLabel;

  const kwLabel = getTopKeywordsClusterLabel(keywordCounts, indices.length);
  if (kwLabel) return kwLabel;

  const sourceCounts = new Map<string, number>();
  tallyFromIndices(sourceCounts, indices, (idx) => [signals[idx].source]);
  const sourceLabel = getMajorityClusterLabel(sourceCounts, indices.length);
  if (sourceLabel) return sourceLabel;

  return `Cluster ${clusterCount + 1}`;
}

function sortRowsByInputOrder(rows: ContentItemRow[], order: ContentItemRow[]): ContentItemRow[] {
  const orderMap = new Map<string, number>();
  order.forEach((item, i) => {
    if (!orderMap.has(item.id)) orderMap.set(item.id, i);
  });
  return [...rows].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
}

function unionFind(n: number): { find: (x: number) => number; union: (x: number, y: number) => void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(x: number, y: number): void {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  }
  return { find, union };
}

function withLlmModel<T extends ContentItemRow>(
  ctx: TransformContext,
  items: T[],
  work: (model: NonNullable<TransformContext["llmModel"]>) => Promise<T[]>
): Promise<T[]> {
  if (!ctx.llmModel) return Promise.resolve(items);
  return work(ctx.llmModel);
}

type TransformFn = (
  items: ContentItemRow[],
  config: TransformConfig,
  ctx: TransformContext
) => Promise<ContentItemRow[]>;

const transforms: Record<string, TransformFn> = {
  latest: async (items, config) => {
    const { count } = config as { type: "latest"; count: number };
    return items.slice(0, count);
  },

  filter: async (items, config) => {
    const { keywords, fields } = config as Extract<TransformConfig, { type: "filter" }>;
    return filterByKeywordMatch(items, { keywords, fields }, true);
  },

  exclude: async (items, config) => {
    const { keywords, fields } = config as Extract<TransformConfig, { type: "exclude" }>;
    return filterByKeywordMatch(items, { keywords, fields }, false);
  },

  sort: async (items, config) => {
    const { field, direction } = config as {
      type: "sort";
      field: "timestamp" | "title" | "source";
      direction?: "asc" | "desc";
    };
    const dir = direction === "asc" ? 1 : -1;
    const effectiveDirection = direction ?? "desc";
    return [...items].sort((a, b) => {
      const av = a[field] ?? "";
      const bv = b[field] ?? "";
      if (field === "timestamp") {
        return compareIsoTimestamp(av, bv, effectiveDirection);
      }
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  },

  dedupe: async (items, config) => {
    const cfg = config as {
      type: "dedupe";
      strategy?: DedupeStrategy;
      threshold?: number;
      keep?: "highest-score" | "earliest" | "latest";
      log?: boolean;
    };
    const strategy = cfg.strategy ?? "url";
    const threshold = cfg.threshold ?? 0.85;
    const keep = cfg.keep ?? "highest-score";
    const shouldLog = cfg.log !== false; // log by default

    const logRemovedDups = (label: string, removed: string[], extra: string = "") => {
      console.log(`[dedupe:${label}] removed ${removed.length} duplicate(s)${extra}:`);
      for (const r of removed.slice(0, 10)) console.log(`  - ${r}`);
      if (removed.length > 10) console.log(`  ... and ${removed.length - 10} more`);
    };

    const maybeLogRemoved = (label: string, removed: string[], extra: string = "") => {
      if (shouldLog && removed.length > 0) {
        logRemovedDups(label, removed, extra);
      }
    };

    if (strategy === "url") {
      const seen = new Set<string>();
      const removed: string[] = [];
      const result = items.filter((item) => {
        if (!item.url || seen.has(item.url)) {
          if (item.url) removed.push(`"${item.title}" (${item.url})`);
          return false;
        }
        seen.add(item.url);
        return true;
      });
      maybeLogRemoved("url", removed);
      return result;
    }

    if (strategy === "domain-normalized") {
      const groups = new Map<string, ContentItemRow[]>();
      for (const item of items) {
        pushToGroup(groups, normalizeUrl(item.url), item);
      }
      const result: ContentItemRow[] = [];
      const removed: string[] = [];
      for (const [, group] of groups) {
        const winner = pickWinner(group, keep);
        result.push(winner);
        removed.push(
          ...collectLosers(group, winner, (item, w) =>
            `"${item.title}" (${item.url}) -> kept "${w.title}"`
          )
        );
      }
      maybeLogRemoved("domain-normalized", removed);
      return sortRowsByInputOrder(result, items);
    }

    if (strategy === "title-similarity") {
      const kept: ContentItemRow[] = [];
      const removed: string[] = [];
      for (const item of items) {
        let isDuplicate = false;
        for (const existing of kept) {
          const similarity = titleSimilarity(item.title, existing.title);
          if (similarity !== null && similarity >= threshold) {
            const winner = pickWinner([existing, item], keep);
            if (winner === item) {
              const idx = kept.indexOf(existing);
              kept[idx] = item;
              removed.push(
                `"${existing.title}" (sim=${similarity.toFixed(2)}) -> kept "${item.title}"`
              );
            } else {
              removed.push(
                `"${item.title}" (sim=${similarity.toFixed(2)}) -> kept "${existing.title}"`
              );
            }
            isDuplicate = true;
            break;
          }
        }
        if (!isDuplicate) {
          kept.push(item);
        }
      }
      maybeLogRemoved("title-similarity", removed, ` (threshold=${threshold})`);
      return kept;
    }

    console.warn(`[dedupe] unknown strategy "${strategy}", passing items through`);
    return items;
  },

  "keyword-score": async (items, config) => {
    const cfg = config as {
      type: "keyword-score";
      keywords: KeywordScoreEntry[];
      min_score?: number;
      annotate?: boolean;
    };
    const keywords = cfg.keywords ?? [];
    const minScore = cfg.min_score ?? undefined;
    const annotate = cfg.annotate ?? false;

    if (keywords.length === 0) return items;

    // Pre-compile regex patterns for regex entries, plain lowercase strings for others
    const matchers = keywords.map((kw) => {
      if (kw.regex) {
        try {
          return { regex: new RegExp(kw.term, "gi"), weight: kw.weight, term: kw.term };
        } catch {
          console.warn(`[keyword-score] invalid regex "${kw.term}", treating as literal`);
          return { regex: null, literal: kw.term.toLowerCase(), weight: kw.weight, term: kw.term };
        }
      }
      return { regex: null, literal: kw.term.toLowerCase(), weight: kw.weight, term: kw.term };
    });

    interface ScoredItem {
      row: ContentItemRow;
      score: number;
      matchedTerms: string[];
    }

    const scored: ScoredItem[] = items.map((item) => {
      const title = (item.title ?? "").toLowerCase();
      const body = (item.body ?? "").toLowerCase();
      const titleOrig = item.title ?? "";
      const bodyOrig = item.body ?? "";
      let score = 0;
      const matchedTerms: string[] = [];

      for (const matcher of matchers) {
        let matchCount = 0;

        if (matcher.regex) {
          // Reset lastIndex for global regex
          matcher.regex.lastIndex = 0;
          const titleMatches = titleOrig.match(matcher.regex);
          const bodyMatches = bodyOrig.match(matcher.regex);
          matchCount = (titleMatches?.length ?? 0) + (bodyMatches?.length ?? 0);
        } else {
          // Case-insensitive literal matching - count occurrences
          const literal = matcher.literal!;
          let idx = 0;
          while ((idx = title.indexOf(literal, idx)) !== -1) {
            matchCount++;
            idx += literal.length;
          }
          idx = 0;
          while ((idx = body.indexOf(literal, idx)) !== -1) {
            matchCount++;
            idx += literal.length;
          }
        }

        if (matchCount > 0) {
          score += matcher.weight * matchCount;
          matchedTerms.push(`${matcher.term}(${matchCount > 1 ? "x" + matchCount : ""}${matcher.weight > 0 ? "+" : ""}${matcher.weight})`);
        }
      }

      return { row: item, score, matchedTerms };
    });

    // Filter by minimum score if specified
    let filtered = filterByMinScore(scored, minScore, (s) => s.score, "keyword-score");

    // Sort by score descending (stable: items with same score keep original order)
    sortByScoreDesc(filtered, (s) => s.score);

    // Annotate items with matched keywords if requested
    const result = filtered.map((s) => {
      if (annotate && s.matchedTerms.length > 0) {
        const annotation = `\n---\n[keyword-score: ${s.score}] ${s.matchedTerms.join(", ")}`;
        return annotateRow(s.row, annotation);
      }
      return s.row;
    });

    console.log(
      `[keyword-score] scored ${items.length} items, ${result.length} passed` +
        (result.length > 0
          ? ` (top score: ${filtered[0]?.score}, bottom: ${filtered[filtered.length - 1]?.score})`
          : "")
    );

    return result;
  },

  "time-decay": async (items, config) => {
    const cfg = config as {
      type: "time-decay";
      half_life?: string;
      engagement_weight?: number;
      recency_weight?: number;
      decay?: "exponential" | "linear";
      annotate?: boolean;
      min_score?: number;
    };

    const halfLifeStr = cfg.half_life ?? "12h";
    const engagementWeight = cfg.engagement_weight ?? 0.7;
    const recencyWeight = cfg.recency_weight ?? 0.3;
    const decayType = cfg.decay ?? "exponential";
    const annotate = cfg.annotate ?? false;
    const minScore = cfg.min_score ?? undefined;

    // Parse half-life string into milliseconds
    const halfLifeMs = parseHalfLife(halfLifeStr);

    const now = Date.now();

    // Compute engagement scores and find the max for normalization
    const engagementScores = items.map((item) => extractEngagementScore(item.body));
    const maxEngagement = Math.max(1, ...engagementScores); // avoid division by zero

    // Compute time-decay scores
    interface DecayScored {
      row: ContentItemRow;
      engagementNorm: number;
      recencyNorm: number;
      finalScore: number;
    }

    const scored: DecayScored[] = items.map((item, i) => {
      // Normalize engagement to [0, 1] using log scale for better distribution
      const rawEngagement = engagementScores[i];
      const engagementNorm = maxEngagement > 1
        ? Math.log(1 + rawEngagement) / Math.log(1 + maxEngagement)
        : (rawEngagement > 0 ? 1 : 0);

      // Compute age in ms
      const itemTime = new Date(item.timestamp).getTime();
      const ageMs = Math.max(0, now - itemTime);

      // Compute recency score via decay function
      let recencyNorm: number;
      if (decayType === "exponential") {
        // Exponential decay: score = 2^(-age / half_life)
        recencyNorm = Math.pow(2, -(ageMs / halfLifeMs));
      } else {
        // Linear decay: score = max(0, 1 - age / (2 * half_life))
        // Items older than 2x half-life get score 0
        recencyNorm = Math.max(0, 1 - ageMs / (2 * halfLifeMs));
      }

      // Combined weighted score
      const finalScore = engagementWeight * engagementNorm + recencyWeight * recencyNorm;

      return { row: item, engagementNorm, recencyNorm, finalScore };
    });

    // Filter by minimum score if specified
    let filtered = filterByMinScore(scored, minScore, (s) => s.finalScore, "time-decay");

    // Sort by final score descending (stable sort preserves order for ties)
    sortByScoreDesc(filtered, (s) => s.finalScore);

    // Annotate items with computed scores if requested
    const result = filtered.map((s) => {
      if (annotate) {
        const annotation = `\n---\n[hot-score: ${s.finalScore.toFixed(3)}] engagement=${s.engagementNorm.toFixed(3)} recency=${s.recencyNorm.toFixed(3)} (${decayType}, half_life=${halfLifeStr})`;
        return annotateRow(s.row, annotation);
      }
      return s.row;
    });

    console.log(
      `[time-decay] ranked ${items.length} items (decay=${decayType}, half_life=${halfLifeStr}, weights=${engagementWeight}/${recencyWeight})` +
        (result.length > 0
          ? ` top=${filtered[0]?.finalScore.toFixed(3)}, bottom=${filtered[filtered.length - 1]?.finalScore.toFixed(3)}`
          : "")
    );

    return result;
  },

  cluster: async (items, config) => {
    const cfg = config as Extract<TransformConfig, { type: "cluster" }>;

    const strategy = cfg.strategy ?? "auto";
    const minClusterSize = cfg.min_cluster_size ?? 2;
    const maxClusters = cfg.max_clusters ?? 10;
    const similarityThreshold = cfg.similarity_threshold ?? 0.3;
    const annotate = cfg.annotate ?? true;

    if (items.length < 2) return items;

    const STOP_WORDS = new Set([
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
      "him", "she", "he", "us", "who", "whom",
      // Common metadata words that appear in body annotations (not useful for clustering)
      "points", "point", "comments", "comment", "discuss", "discussion",
      "stars", "star", "likes", "like", "views", "view", "votes", "vote",
      "upvotes", "upvote", "boosts", "boost", "favorites", "favourite",
      "reactions", "reaction", "replies", "reply", "https", "http", "www",
      "com", "org", "net", "reddit", "github", "show", "item", "news",
      "ycombinator", "lobste", "read", "min", "cover",
    ]);

    function extractDomain(url: string): string {
      try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./, "");
      } catch (err) {
        console.warn(`transforms: extractDomain failed for "${url}": ${errorMessage(err)}`);
        return "";
      }
    }

    function extractKeywords(text: string): string[] {
      return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
    }

    const signals: ClusterItemSignals[] = items.map((item) => {
      const titleKeywords = extractKeywords(item.title ?? "");
      // For body, extract only descriptive keywords:
      // 1. Strip URLs (they contain domain noise like "ycombinator", "lobste", etc.)
      // 2. Strip common metadata patterns (N points | by author | N comments | discuss: ...)
      const body = item.body ?? "";
      const bodyClean = body
        .replace(/https?:\/\/[^\s|]+/g, "") // remove URLs
        .replace(/\d+\s*(points?|comments?|reactions?|replies?|views?|stars?|boosts?|favorites?|likes?|upvotes?)/gi, "") // remove metric counts
        .replace(/\bby\s+\S+/g, "") // remove "by author"
        .replace(/\btags?:\s*[^\n|]+/gi, "") // remove "tags: ..."
        .replace(/\bdiscuss:/gi, "") // remove "discuss:"
        .replace(/[|]/g, " "); // pipe to space
      const bodyKeywords = extractKeywords(bodyClean.slice(0, 150));
      const allKeywords = new Set([...titleKeywords, ...bodyKeywords]);

      return {
        domain: extractDomain(item.url),
        keywords: allKeywords,
        source: item.source ?? item.panel_id ?? "",
      };
    });

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

    function computeSimilarity(a: ClusterItemSignals, b: ClusterItemSignals): number {
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

    const similarities: Array<{ i: number; j: number; sim: number }> = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const sim = computeSimilarity(signals[i], signals[j]);
        if (sim >= similarityThreshold) {
          similarities.push({ i, j, sim });
        }
      }
    }

    similarities.sort((a, b) => b.sim - a.sim);

    const { find, union } = unionFind(items.length);
    for (const { i, j } of similarities) {
      union(i, j);
    }

    const clusterMap = new Map<number, number[]>();
    for (let i = 0; i < items.length; i++) {
      const root = find(i);
      const group = clusterMap.get(root) ?? [];
      group.push(i);
      clusterMap.set(root, group);
    }

    const clusters: Array<{ indices: number[]; label: string }> = [];
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

    const result: ContentItemRow[] = [];
    for (const cluster of clusters) {
      cluster.label = generateClusterLabel(cluster.indices, signals, clusters.length);
      sortByScoreDesc(cluster.indices, (idx) => extractEngagementScore(items[idx].body));
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

    const clusterSummary = clusters
      .map((c) => `"${c.label}" (${c.indices.length} items)`)
      .join(", ");
    console.log(
      `[cluster] strategy=${strategy}, ${clusters.length} cluster(s): ${clusterSummary || "none"}, ${unclustered.length} unclustered`
    );

    return result;
  },

  "llm-summarize": (items, _config, ctx) =>
    withLlmModel(ctx, items, async (model) => {
      const results: ContentItemRow[] = [];
      for (const item of items) {
        if (item.summary) {
          results.push(item);
          continue;
        }
        const summary = await summarizeItem(model, rowToContentItem(item));
        results.push({ ...item, summary: summary ?? item.summary });
      }
      return results;
    }),

  "llm-filter": (items, config, ctx) =>
    withLlmModel(ctx, items, async (model) => {
      const { criteria } = config as { type: "llm-filter"; criteria: string };
      const contentItems = toContentItems(items);
      const filtered = await filterItemsByLlm(model, contentItems, criteria);
      const keepIds = new Set(filtered.map((i) => i.id));
      return items.filter((row) => keepIds.has(row.id));
    }),

  "llm-rank": (items, config, ctx) =>
    withLlmModel(ctx, items, async (model) => {
      const { interests } = config as { type: "llm-rank"; interests?: string[] };
      const effectiveInterests = interests ?? ctx.llmConfig?.interests ?? [];
      if (effectiveInterests.length === 0) return items;
      const contentItems = toContentItems(items);
      const ranked = await lensItems(model, contentItems, effectiveInterests);
      const rowById = new Map(items.map((r) => [r.id, r]));
      const order: ContentItemRow[] = [];
      const seen = new Set<string>();
      for (const item of ranked) {
        const row = rowById.get(item.id);
        if (row) {
          order.push(row);
          seen.add(row.id);
        }
      }
      for (const row of items) {
        if (!seen.has(row.id)) order.push(row);
      }
      return sortRowsByInputOrder(items, order);
    }),

  "llm-merge": (items, config, ctx) =>
    withLlmModel(ctx, items, async (model) => {
      const { prompt } = config as { type: "llm-merge"; prompt?: string };
      const contentItems = toContentItems(items);
      const merged = await mergeItems(model, contentItems, prompt);
      const rowMap = new Map<string, ContentItemRow>();
      for (const row of items) rowMap.set(row.id, row);
      return merged.map((item) => {
        const baseRow = rowMap.get(item.id) ?? rowMap.get(item.id.split("+")[0]);
        return contentItemToRow(item, baseRow);
      });
    }),
};

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
