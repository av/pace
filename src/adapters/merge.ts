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

/** Fetch each key in parallel and flatten results. */
export async function fetchAllParallel<T, K>(
  keys: readonly K[],
  fetchOne: (key: K) => Promise<T[]>,
): Promise<T[]> {
  const results = await Promise.all(keys.map(fetchOne));
  return results.flat();
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

/** Keep first occurrence per key (overlap when merging multiple tags/endpoints). */
export function dedupeByKey<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Compare items newest-first by `timestamp` Date field (for finalizeFetchedItems sort). */
export function compareItemTimestampDesc<T extends { timestamp: Date }>(a: T, b: T): number {
  return b.timestamp.getTime() - a.timestamp.getTime();
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