import { compareIsoTimestamp } from "../utils";

/** Fetch each key sequentially and concatenate results (multi-tag / multi-endpoint merge). */
export async function fetchAndConcat<T>(
  keys: readonly string[],
  fetchOne: (key: string) => Promise<T[]>,
): Promise<T[]> {
  const merged: T[] = [];
  for (const key of keys) {
    merged.push(...(await fetchOne(key)));
  }
  return merged;
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