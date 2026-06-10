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
import {
  dedupeByTitleSimilarity,
  dedupeGroupedByKey,
  normalizeUrl,
} from "./dedupe";
import { sliceToLimit } from "./utils";

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

function formatDedupeRemovedLine(loser: ContentItemRow, winner?: ContentItemRow): string {
  const line = `"${loser.title}" (${loser.url})`;
  return winner ? `${line} -> kept "${winner.title}"` : line;
}

function finalizeDedupeRun(
  { result, removed }: { result: ContentItemRow[]; removed: string[] },
  label: string,
  shouldLog: boolean,
  extra = "",
): ContentItemRow[] {
  maybeLogDedupeRemoved(shouldLog, label, removed, extra);
  return result;
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

function applyDedupeTitleSimilarity(
  items: ContentItemRow[],
  threshold: number,
  keep: DedupeKeep,
  shouldLog: boolean,
): ContentItemRow[] {
  return finalizeDedupeRun(
    dedupeByTitleSimilarity(items, threshold, keep, (loser, winner) =>
      formatDedupeRemovedLine(loser, winner),
    ),
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

