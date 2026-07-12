import {
  DEDUPE_DEFAULT_KEEP,
  DEDUPE_DEFAULT_STRATEGY,
  DEDUPE_DEFAULT_THRESHOLD,
  isDedupeStrategy,
  type DedupeKeep,
  type DedupeStrategy,
  type KeywordField,
  type TransformConfig,
} from "./config/types";
import type { ContentItemRow } from "./db";
import {
  finalizeDedupeRun,
  formatTransformDedupeRemovedLine,
  warnUnknownDedupeStrategy,
} from "./transform-warn";
import {
  dedupeByTitleSimilarity,
  dedupeGroupedByKey,
  normalizeUrl,
} from "./dedupe";
import { sliceToLimit } from "./utils";

export type LatestTransformConfig = Extract<TransformConfig, { type: "latest" }>;

export function applyLatest(
  items: ContentItemRow[],
  { count, per_source: perSource }: LatestTransformConfig
): ContentItemRow[] {
  if (perSource !== undefined) {
    const sourceCounts = new Map<string, number>();
    const result: ContentItemRow[] = [];
    for (const item of items) {
      const seen = sourceCounts.get(item.source) ?? 0;
      if (seen >= perSource) continue;
      sourceCounts.set(item.source, seen + 1);
      result.push(item);
      if (result.length === count) break;
    }
    return result;
  }
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
  const noUrlItems = items.filter((item) => !item.url);
  return [
    ...finalizeDedupeRun(
      dedupeGroupedByKey(
        urlItems,
        (item) => item.url!,
        "first",
        (item) => formatTransformDedupeRemovedLine(item),
      ),
      "url",
      shouldLog,
    ),
    ...noUrlItems,
  ];
}

function applyDedupeDomainNormalized(
  items: ContentItemRow[],
  keep: DedupeKeep,
  shouldLog: boolean,
): ContentItemRow[] {
  const urlItems = items.filter((item) => item.url);
  const noUrlItems = items.filter((item) => !item.url);
  return [
    ...finalizeDedupeRun(
      dedupeGroupedByKey(
        urlItems,
        (item) => normalizeUrl(item.url),
        keep,
        (item, winner) => formatTransformDedupeRemovedLine(item, winner),
      ),
      "domain-normalized",
      shouldLog,
    ),
    ...noUrlItems,
  ];
}

function applyDedupeTitleSimilarity(
  items: ContentItemRow[],
  threshold: number,
  keep: DedupeKeep,
  shouldLog: boolean,
): ContentItemRow[] {
  return finalizeDedupeRun(
    dedupeByTitleSimilarity(items, threshold, keep, (loser, winner) =>
      formatTransformDedupeRemovedLine(loser, winner),
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
