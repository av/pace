import { dedupeByKey } from "../dedupe";
import { sliceToLimit, sleep } from "../utils";

/** Map each key sequentially and concatenate results (sync multi-mode / multi-section merge). */
export function mapAndConcat<T, K = string>(
  keys: readonly K[],
  mapOne: (key: K) => T[],
): T[] {
  const merged: T[] = [];
  for (const key of keys) {
    merged.push(...mapOne(key));
  }
  return merged;
}

/** Fetch each key sequentially and concatenate results (multi-tag / multi-endpoint merge). */
export async function fetchAndConcat<T, K = string>(
  keys: readonly K[],
  fetchOne: (key: K) => Promise<T[]>,
): Promise<T[]> {
  const merged: T[] = [];
  for (const key of keys) {
    merged.push(...(await fetchOne(key)));
  }
  return merged;
}

/** Fetch each key in parallel, tolerating individual failures.
 *  Successful results are flattened; failed keys are warned and skipped.
 *  If ALL keys fail, the first error is rethrown so the adapter reports failure. */
export async function fetchAllParallel<T, K>(
  keys: readonly K[],
  fetchOne: (key: K) => Promise<T[]>,
): Promise<T[]> {
  const settled = await Promise.allSettled(keys.map(fetchOne));
  const items: T[] = [];
  const failures: { index: number; reason: unknown }[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      failures.push({ index: i, reason: result.reason });
    }
  }
  if (items.length === 0 && failures.length > 0) {
    throw failures[0].reason;
  }
  for (const f of failures) {
    const msg = f.reason instanceof Error ? f.reason.message : String(f.reason);
    console.warn(`feed: skipping source ${f.index + 1}/${keys.length}: ${msg}`);
  }
  return items;
}

/** Global cap when each source may contribute up to `perSourceLimit` items. */
export function perSourceTotalLimit(perSourceLimit: number, sourceCount: number): number {
  if (perSourceLimit === Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return perSourceLimit * sourceCount;
}

export type AggregateParallelFeedsOptions<T> = {
  perSourceLimit: number;
  dedupeKey: (item: T) => unknown;
  sort?: (a: T, b: T) => number;
};

/** Parallel multi-source fetch with shared dedupe/sort/limit finalize pipeline. */
export async function aggregateParallelFeeds<T, K>(
  keys: readonly K[],
  fetchOne: (key: K) => Promise<T[]>,
  options: AggregateParallelFeedsOptions<T>,
): Promise<T[]> {
  const items = await fetchAllParallel(keys, fetchOne);
  return finalizeFetchedItems(items, {
    limit: perSourceTotalLimit(options.perSourceLimit, keys.length),
    dedupeKey: options.dedupeKey,
    sort: options.sort ?? compareItemTimestampDesc,
  });
}

export type AggregateMappedFeedsOptions<T> = FinalizeFetchedItemsOptions<T>;

/** Sync multi-key map with shared dedupe/min-score/sort/limit finalize pipeline. */
export function aggregateMappedFeeds<T, K>(
  keys: readonly K[],
  mapOne: (key: K) => T[],
  options: AggregateMappedFeedsOptions<T>,
): T[] {
  return finalizeFetchedItems(mapAndConcat(keys, mapOne), options);
}

export type AggregateSequentialFeedsOptions<T> = FinalizeFetchedItemsOptions<T>;

/** Sequential multi-source fetch with shared dedupe/min-score/sort/limit finalize pipeline. */
export async function aggregateSequentialFeeds<T, K>(
  keys: readonly K[],
  fetchOne: (key: K) => Promise<T[]>,
  options: AggregateSequentialFeedsOptions<T>,
): Promise<T[]> {
  const items = await fetchAndConcat(keys, fetchOne);
  return finalizeFetchedItems(items, options);
}

/** Parallel fetch in fixed-size batches with optional delay between batches (rate limiting). */
export async function fetchAllBatched<T, K>(
  keys: readonly K[],
  batchSize: number,
  fetchOne: (key: K) => Promise<T>,
  delayMs = 0,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    results.push(...(await Promise.all(batch.map(fetchOne))));
    if (delayMs > 0 && i + batchSize < keys.length) {
      await sleep(delayMs);
    }
  }
  return results;
}

/** Batched fetch where each key returns an array; concatenates in key order (rate-limited multi-source merge). */
export async function fetchAndConcatBatched<T, K>(
  keys: readonly K[],
  batchSize: number,
  fetchOne: (key: K) => Promise<T[]>,
  delayMs = 0,
): Promise<T[]> {
  return (await fetchAllBatched(keys, batchSize, fetchOne, delayMs)).flat();
}

export type AggregateBatchedFeedsOptions<T> = {
  perSourceLimit: number;
  dedupeKey?: (item: T) => unknown;
  minScore?: number;
  scoreOf?: (item: T) => number;
  sort?: (a: T, b: T) => number;
};

/** Batched multi-source fetch with shared dedupe/min-score/sort/per-source total cap finalize pipeline. */
export async function aggregateBatchedFeeds<T, K>(
  keys: readonly K[],
  batchSize: number,
  fetchOne: (key: K) => Promise<T[]>,
  options: AggregateBatchedFeedsOptions<T>,
  delayMs = 0,
): Promise<T[]> {
  const items = await fetchAndConcatBatched(keys, batchSize, fetchOne, delayMs);
  return finalizeFetchedItems(items, {
    limit: perSourceTotalLimit(options.perSourceLimit, keys.length),
    dedupeKey: options.dedupeKey,
    minScore: options.minScore,
    scoreOf: options.scoreOf,
    sort: options.sort ?? compareItemTimestampDesc,
  });
}

/** Batched per-key fetch (0-1 item each); drops nulls, then shared dedupe/min-score/sort/limit finalize pipeline. */
export async function aggregateBatchedItems<T, K>(
  keys: readonly K[],
  batchSize: number,
  fetchOne: (key: K) => Promise<T | null>,
  options: FinalizeFetchedItemsOptions<T>,
  delayMs = 0,
): Promise<T[]> {
  const fetched = await fetchAllBatched(keys, batchSize, fetchOne, delayMs);
  const items = fetched.filter((item): item is T => item !== null);
  return finalizeFetchedItems(items, options);
}

/** Pair batched fetch results with their source keys (order-preserving zip to Map). */
export function zipToKeyedMap<K, V>(
  keys: readonly K[],
  values: readonly V[],
  keyOf: (key: K) => string,
): Map<string, V> {
  const map = new Map<string, V>();
  for (let i = 0; i < keys.length; i++) {
    map.set(keyOf(keys[i]), values[i]);
  }
  return map;
}

/** Batched per-key fetch with keyed results (rate-limited enrichment / lookup). */
export async function fetchAllBatchedKeyed<T, K>(
  keys: readonly K[],
  batchSize: number,
  keyOf: (key: K) => string,
  fetchOne: (key: K) => Promise<T>,
  delayMs = 0,
): Promise<Map<string, T>> {
  const results = await fetchAllBatched(keys, batchSize, fetchOne, delayMs);
  return zipToKeyedMap(keys, results, keyOf);
}

export type FilterItemsByEnrichedScoreOptions<T, E> = {
  keyOf: (item: T) => string;
  minScore: number;
  scoreOf: (enrichment: E) => number | undefined;
};

/** Filter primary items by optional per-key enrichment score (e.g. min_upvotes after enrich). */
export function filterItemsByEnrichedScore<T, E>(
  items: readonly T[],
  enrichedByKey: ReadonlyMap<string, E | null | undefined>,
  options: FilterItemsByEnrichedScoreOptions<T, E>,
): T[] {
  if (options.minScore <= 0) return [...items];
  return items.filter((item) => {
    const enrichment = enrichedByKey.get(options.keyOf(item));
    if (enrichment == null) return false;
    const score = options.scoreOf(enrichment);
    return score !== undefined && score >= options.minScore;
  });
}

export type EnrichAndFilterBatchedOptions<T, E> = {
  batchSize: number;
  delayMs?: number;
  keyOf: (item: T) => string;
  enrich: (item: T) => Promise<E | null>;
  minScore?: number;
  scoreOf?: (enrichment: E) => number | undefined;
};

/** Batched secondary enrichment with optional score filter on enrichment metadata. */
export async function enrichAndFilterItemsBatched<T, E>(
  items: readonly T[],
  options: EnrichAndFilterBatchedOptions<T, E>,
): Promise<{ enrichedByKey: Map<string, E | null>; items: T[] }> {
  const enrichedByKey = await fetchAllBatchedKeyed(
    items,
    options.batchSize,
    options.keyOf,
    options.enrich,
    options.delayMs ?? 0,
  );
  const minScore = options.minScore ?? 0;
  const filtered =
    minScore > 0 && options.scoreOf
      ? filterItemsByEnrichedScore(items, enrichedByKey, {
          keyOf: options.keyOf,
          minScore,
          scoreOf: options.scoreOf,
        })
      : [...items];
  return { enrichedByKey, items: filtered };
}

/** Compare items newest-first by `timestamp` Date field (for finalizeFetchedItems sort). */
export function compareItemTimestampDesc<T extends { timestamp: Date }>(a: T, b: T): number {
  return b.timestamp.getTime() - a.timestamp.getTime();
}

/** Slice only when limit is set (multi-mode extractors defer cap to aggregateMappedFeeds). */
export function optionalSliceToLimit<T>(
  items: readonly T[],
  limit: number | undefined,
): readonly T[] {
  return limit === undefined ? items : sliceToLimit(items, limit);
}

/** Limit raw feed rows before mapping (avoids parsing entries dropped by per-feed cap). */
export function sliceAndMap<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => R,
): R[] {
  return sliceToLimit(items, limit).map(map);
}

/** Like sliceAndMap, but drops null/undefined mapper results (e.g. unparseable feed rows). */
export function sliceAndMapDefined<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => R | null | undefined,
): R[] {
  const result: R[] = [];
  for (const item of sliceToLimit(items, limit)) {
    const mapped = map(item);
    if (mapped != null) {
      result.push(mapped);
    }
  }
  return result;
}

export type FinalizeFetchedItemsOptions<T> = {
  limit: number;
  dedupeKey?: (item: T) => unknown;
  minScore?: number;
  scoreOf?: (item: T) => number;
  sort?: (a: T, b: T) => number;
};

/** Shared post-fetch pipeline: optional dedupe, min-score filter, sort, then slice. */
export function finalizeFetchedItems<T>(
  items: readonly T[],
  options: FinalizeFetchedItemsOptions<T>,
): T[] {
  let result = [...items];
  if (options.dedupeKey) {
    result = dedupeByKey(result, options.dedupeKey);
  }
  const minScore = options.minScore ?? 0;
  if (minScore > 0 && options.scoreOf) {
    result = result.filter((item) => options.scoreOf!(item) >= minScore);
  }
  if (options.sort) {
    result.sort(options.sort);
  }
  return sliceToLimit(result, options.limit);
}