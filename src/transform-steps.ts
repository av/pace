import {
  type TransformConfig,
  type KeywordField,
  type DedupeStrategy,
  type DedupeKeep,
  DEDUPE_DEFAULT_STRATEGY,
  DEDUPE_DEFAULT_THRESHOLD,
  DEDUPE_DEFAULT_KEEP,
  isDedupeStrategy,
} from "./config";
import type { ContentItemRow } from "./db";
import { logTransformDedupeRemoved, warnUnknownDedupeStrategy } from "./transform-warn";
import { extractScore } from "./adapters/engagement";
import { normalizeUrl, levenshteinSimilarity } from "./dedupe";
import { compareIsoTimestamp, sliceToLimit } from "./utils";

export type LatestTransformConfig = Extract<TransformConfig, { type: "latest" }>;

export function applyLatest(
  items: ContentItemRow[],
  { count }: LatestTransformConfig
): ContentItemRow[] {
  return sliceToLimit(items, count);
}

type KeywordMatchConfig = Extract<TransformConfig, { type: "filter" } | { type: "exclude" }>;
export type FilterTransformConfig = Extract<TransformConfig, { type: "filter" }>;
export type ExcludeTransformConfig = Extract<TransformConfig, { type: "exclude" }>;

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

function filterByKeywordMatch(
  items: ContentItemRow[],
  { keywords, fields }: Pick<KeywordMatchConfig, "keywords" | "fields">,
  keepMatches: boolean
): ContentItemRow[] {
  const predicate = makeKeywordPredicate(keywords, fields);
  return items.filter((item) => keepMatches === predicate(item));
}

export function applyFilter(items: ContentItemRow[], config: FilterTransformConfig): ContentItemRow[] {
  return filterByKeywordMatch(items, config, true);
}

export function applyExclude(items: ContentItemRow[], config: ExcludeTransformConfig): ContentItemRow[] {
  return filterByKeywordMatch(items, config, false);
}

function pickByTimestamp(group: ContentItemRow[], direction: "asc" | "desc"): ContentItemRow {
  return group.reduce((a, b) =>
    compareIsoTimestamp(a.timestamp, b.timestamp, direction) <= 0 ? a : b
  );
}

type DedupePick = DedupeKeep | "first";

function formatDedupeRemovedLine(loser: ContentItemRow, winner?: ContentItemRow): string {
  const line = `"${loser.title}" (${loser.url})`;
  return winner ? `${line} -> kept "${winner.title}"` : line;
}

function pickWinner(group: ContentItemRow[], keep: DedupePick): ContentItemRow {
  if (group.length === 1) return group[0];
  if (keep === "first") return group[0];
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

type DedupeRunResult = { result: ContentItemRow[]; removed: string[] };

function finalizeDedupeRun(
  { result, removed }: DedupeRunResult,
  label: string,
  shouldLog: boolean,
  extra = "",
): ContentItemRow[] {
  maybeLogDedupeRemoved(shouldLog, label, removed, extra);
  return result;
}

function dedupeGroupedByKey(
  items: ContentItemRow[],
  keyOf: (item: ContentItemRow) => string,
  keep: DedupePick,
  formatRemoved: (loser: ContentItemRow, winner: ContentItemRow) => string,
): { result: ContentItemRow[]; removed: string[] } {
  const groups = new Map<string, ContentItemRow[]>();
  for (const item of items) {
    pushToGroup(groups, keyOf(item), item);
  }
  const result: ContentItemRow[] = [];
  const removed: string[] = [];
  for (const [, group] of groups) {
    const winner = pickWinner(group, keep);
    result.push(winner);
    removed.push(...collectLosers(group, winner, formatRemoved));
  }
  return { result: sortRowsByInputOrder(result, items), removed };
}

function maybeLogDedupeRemoved(shouldLog: boolean, label: string, removed: string[], extra = ""): void {
  if (shouldLog && removed.length > 0) logTransformDedupeRemoved(label, removed, extra);
}

interface DedupeRunOptions {
  strategy: DedupeStrategy;
  threshold: number;
  keep: DedupeKeep;
  shouldLog: boolean;
}

export type DedupeTransformConfig = Extract<TransformConfig, { type: "dedupe" }>;

function resolveDedupeOptions(cfg: DedupeTransformConfig): DedupeRunOptions {
  return {
    strategy: cfg.strategy ?? DEDUPE_DEFAULT_STRATEGY,
    threshold: cfg.threshold ?? DEDUPE_DEFAULT_THRESHOLD,
    keep: cfg.keep ?? DEDUPE_DEFAULT_KEEP,
    shouldLog: cfg.log !== false,
  };
}

function applyDedupeUrl(items: ContentItemRow[], shouldLog: boolean): ContentItemRow[] {
  const urlItems = items.filter((item) => item.url);
  return finalizeDedupeRun(
    dedupeGroupedByKey(
      urlItems,
      (item) => item.url!,
      "first",
      (item) => formatDedupeRemovedLine(item),
    ),
    "url",
    shouldLog,
  );
}

function applyDedupeDomainNormalized(
  items: ContentItemRow[],
  keep: DedupeKeep,
  shouldLog: boolean,
): ContentItemRow[] {
  return finalizeDedupeRun(
    dedupeGroupedByKey(
      items,
      (item) => normalizeUrl(item.url),
      keep,
      (item, winner) => formatDedupeRemovedLine(item, winner),
    ),
    "domain-normalized",
    shouldLog,
  );
}

function dedupeByTitleSimilarity(
  items: ContentItemRow[],
  threshold: number,
  keep: DedupeKeep,
): DedupeRunResult {
  const kept: ContentItemRow[] = [];
  const removed: string[] = [];
  for (const item of items) {
    let isDuplicate = false;
    for (const existing of kept) {
      const similarity = titleSimilarity(item.title, existing.title);
      if (similarity !== null && similarity >= threshold) {
        const winner = pickWinner([existing, item], keep);
        const loser = winner === item ? existing : item;
        if (winner === item) {
          const idx = kept.indexOf(existing);
          kept[idx] = item;
        }
        removed.push(formatDedupeRemovedLine(loser, winner));
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) kept.push(item);
  }
  return { result: kept, removed };
}

function applyDedupeTitleSimilarity(
  items: ContentItemRow[],
  threshold: number,
  keep: DedupeKeep,
  shouldLog: boolean,
): ContentItemRow[] {
  return finalizeDedupeRun(
    dedupeByTitleSimilarity(items, threshold, keep),
    "title-similarity",
    shouldLog,
    ` (threshold=${threshold})`,
  );
}

export function applyDedupe(items: ContentItemRow[], config: DedupeTransformConfig): ContentItemRow[] {
  const opts = resolveDedupeOptions(config);
  if (!isDedupeStrategy(opts.strategy)) {
    warnUnknownDedupeStrategy(opts.strategy);
    return items;
  }
  switch (opts.strategy) {
    case "url":
      return applyDedupeUrl(items, opts.shouldLog);
    case "domain-normalized":
      return applyDedupeDomainNormalized(items, opts.keep, opts.shouldLog);
    case "title-similarity":
      return applyDedupeTitleSimilarity(items, opts.threshold, opts.keep, opts.shouldLog);
  }
}

export function sortRowsByInputOrder(rows: ContentItemRow[], order: ContentItemRow[]): ContentItemRow[] {
  const orderMap = new Map<string, number>();
  order.forEach((item, i) => {
    if (!orderMap.has(item.id)) orderMap.set(item.id, i);
  });
  return [...rows].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
}