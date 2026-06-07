import { compareIsoTimestamp, sliceToLimit, sleep } from "../utils";

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

/** Parallel fetch + dedupe by key (overlap when merging multiple sources). */
export async function fetchAllParallelDedupe<T, K, DedupeKey>(
  keys: readonly K[],
  fetchOne: (key: K) => Promise<T[]>,
  keyOf: (item: T) => DedupeKey,
): Promise<T[]> {
  return dedupeByKey(await fetchAllParallel(keys, fetchOne), keyOf);
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

/** Sort items newest-first by ISO `created_at` timestamp. */
export function sortByCreatedAtDesc<T extends { created_at: string }>(items: T[]): void {
  items.sort((a, b) => compareIsoTimestamp(a.created_at, b.created_at, "desc"));
}

/** Compare items newest-first by `timestamp` Date field (for finalizeFetchedItems sort). */
export function compareItemTimestampDesc<T extends { timestamp: Date }>(a: T, b: T): number {
  return b.timestamp.getTime() - a.timestamp.getTime();
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