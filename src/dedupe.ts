import { errorMessage } from "./utils";

export type DedupeStrategy = "url" | "domain-normalized" | "title-similarity";

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

export function normalizeUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);

    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

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
  } catch (err) {
    console.warn(`dedupe: normalizeUrl failed for "${url}": ${errorMessage(err)}`);
    return url.toLowerCase().trim();
  }
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

export { extractScore } from "./adapters/engagement";
