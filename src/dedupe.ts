/**
 * Deduplication utilities for the dedupe transform.
 *
 * Strategies:
 * - "url": exact URL match (fastest)
 * - "domain-normalized": normalize URLs (strip tracking params, www., trailing slashes)
 * - "title-similarity": Levenshtein-based fuzzy title matching
 */

export type DedupeStrategy = "url" | "domain-normalized" | "title-similarity";

/** Tracking/analytics URL parameters to strip during normalization */
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

/**
 * Normalize a URL for deduplication comparison.
 * Strips tracking parameters, removes www. prefix, normalizes trailing slashes,
 * lowercases the host, and removes fragments.
 */
export function normalizeUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);

    // Lowercase hostname and remove www.
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    // Remove tracking parameters
    const params = new URLSearchParams(parsed.search);
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        params.delete(key);
      }
    }
    parsed.search = params.toString() ? `?${params.toString()}` : "";

    // Remove fragment
    parsed.hash = "";

    // Normalize trailing slash: remove it unless path is just "/"
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, return as-is lowercased
    return url.toLowerCase().trim();
  }
}

/**
 * Compute Levenshtein distance between two strings.
 * Uses optimized single-row DP approach.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for memory efficiency
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;

  // Single row DP
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

/**
 * Compute similarity between two strings as a value between 0 and 1.
 * 1 = identical, 0 = completely different.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/** Regex patterns (in priority order) for extracting numeric scores from common item metadata formats */
const SCORE_PATTERNS: RegExp[] = [
  /(\d+)\s*points?/i, // HN, Lobsters style: "42 points"
  /score:\s*(\d+)/i, // "score: 77"
  /(\d+)\s*upvotes?/i, // "15 upvotes"
];

/**
 * Extract a numeric score from the body text metadata.
 * Looks for patterns like "42 points", "Score: 42", or structured metadata
 * commonly found in HN/Lobsters/Reddit items.
 */
export function extractScore(body: string | null): number {
  if (!body) return 0;
  for (const re of SCORE_PATTERNS) {
    const match = body.match(re);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}
