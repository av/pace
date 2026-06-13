import type { DedupeKeep } from "./config/types";
import type { ContentItemRow } from "./db";
import { extractScore } from "./adapters/engagement";
import { compareIsoTimestamp, normalizeHostname, tryParseUrl } from "./utils";

export type DedupePick = DedupeKeep | "first";

export type DedupeRunResult = { result: ContentItemRow[]; removed: string[] };

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
  "via",
]);

/** Lowercased hostname without `www.`; empty string and warn on parse failure. */
export function extractHostname(url: string, warnContext = "dedupe"): string {
  const parsed = tryParseUrl(url, warnContext, "extractHostname");
  return parsed ? normalizeHostname(parsed.hostname) : "";
}

export function normalizeUrl(url: string): string {
  if (!url) return "";
  const parsed = tryParseUrl(url, "dedupe", "normalizeUrl");
  if (!parsed) {
    return url.toLowerCase().trim();
  }

  parsed.hostname = normalizeHostname(parsed.hostname);

  const params = new URLSearchParams(parsed.search);
  for (const key of [...params.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      params.delete(key);
    }
  }
  const search = params.toString();
  parsed.search = search ? `?${search}` : "";

  parsed.hash = "";

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;

  const row = new Array<number>(aLen + 1);
  for (let i = 0; i <= aLen; i++) row[i] = i;

  for (let j = 1; j <= bLen; j++) {
    let prev = row[0];
    row[0] = j;
    for (let i = 1; i <= aLen; i++) {
      const temp = row[i];
      if (a[i - 1] === b[j - 1]) {
        row[i] = prev;
      } else {
        row[i] = 1 + Math.min(prev, row[i], row[i - 1]);
      }
      prev = temp;
    }
  }

  return row[aLen];
}

export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const kw of a) {
    if (b.has(kw)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function pickByTimestamp(group: ContentItemRow[], direction: "asc" | "desc"): ContentItemRow {
  return group.reduce((a, b) =>
    compareIsoTimestamp(a.timestamp, b.timestamp, direction) <= 0 ? a : b
  );
}

export function pickWinner(group: ContentItemRow[], keep: DedupePick): ContentItemRow {
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

export function titleSimilarity(
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

/** Union all origins arrays from a group onto the winner row. */
export function mergeOrigins(group: ContentItemRow[], winner: ContentItemRow): ContentItemRow {
  if (group.length <= 1) return winner;
  const allOrigins = new Set<string>();
  for (const item of group) {
    if (item.origins) {
      for (const o of JSON.parse(item.origins) as string[]) allOrigins.add(o);
    }
  }
  if (allOrigins.size === 0) return winner;
  return { ...winner, origins: JSON.stringify([...allOrigins]) };
}

export function sortByInputOrder<T extends { id: string }>(rows: T[], order: T[]): T[] {
  const orderMap = new Map<string, number>();
  order.forEach((item, i) => {
    if (!orderMap.has(item.id)) orderMap.set(item.id, i);
  });
  return [...rows].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
}

export function dedupeGroupedByKey(
  items: ContentItemRow[],
  keyOf: (item: ContentItemRow) => string,
  keep: DedupePick,
  formatRemoved: (loser: ContentItemRow, winner: ContentItemRow) => string,
): DedupeRunResult {
  const groups = new Map<string, ContentItemRow[]>();
  for (const item of items) {
    pushToGroup(groups, keyOf(item), item);
  }
  const result: ContentItemRow[] = [];
  const removed: string[] = [];
  for (const [, group] of groups) {
    const rawWinner = pickWinner(group, keep);
    const winner = mergeOrigins(group, rawWinner);
    result.push(winner);
    removed.push(...collectLosers(group, rawWinner, formatRemoved));
  }
  return { result: sortByInputOrder(result, items), removed };
}

export function dedupeByTitleSimilarity(
  items: ContentItemRow[],
  threshold: number,
  keep: DedupeKeep,
  formatRemoved: (loser: ContentItemRow, winner: ContentItemRow) => string,
): DedupeRunResult {
  const kept: ContentItemRow[] = [];
  const removed: string[] = [];
  for (const item of items) {
    let isDuplicate = false;
    for (let ki = 0; ki < kept.length; ki++) {
      const existing = kept[ki];
      const similarity = titleSimilarity(item.title, existing.title);
      if (similarity !== null && similarity >= threshold) {
        const rawWinner = pickWinner([existing, item], keep);
        const loser = rawWinner === item ? existing : item;
        const winner = mergeOrigins([existing, item], rawWinner);
        kept[ki] = winner;
        removed.push(formatRemoved(loser, winner));
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) kept.push(item);
  }
  return { result: kept, removed };
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

export function unionFind(n: number): {
  find: (x: number) => number;
  union: (x: number, y: number) => void;
} {
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
