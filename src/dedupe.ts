import { normalizeHostname, tryParseUrl } from "./utils";

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
