/**
 * Matches a count with optional thousands separators ("12,345") or a plain
 * integer. Grouped separators must be complete 3-digit runs so "12,34" or a
 * trailing "12," never match as one number.
 */
const COUNT_NUMBER_SOURCE = "\\d{1,3}(?:,\\d{3})+|\\d+";

/** Parse a matched count group, tolerating thousands separators. */
function parseCountGroup(group: string): number {
  return parseInt(group.replace(/,/g, ""), 10);
}

function countMetricRe(term: string): RegExp {
  return new RegExp(`(${COUNT_NUMBER_SOURCE})\\s*${term}`, "i");
}

/** Shared metric vocabulary for scoring, stripping, and cluster keyword extraction. */
const COUNT_METRIC_SPECS = [
  { term: "points?", weight: 1 },
  { term: "upvotes?", weight: 1 },
  { term: "boosts?", weight: 1 },
  { term: "favou?rites?", weight: 1 },
  { term: "stars?", weight: 1 },
  { term: "likes?", weight: 1 },
  { term: "comments?", weight: 0.5 },
] as const;

/** Stripped from bodies for keyword extraction but not scored. */
const STRIP_ONLY_METRIC_TERMS = ["reactions?", "replies?", "views?"] as const;

export const ENGAGEMENT_STRIP_TERMS = [
  ...COUNT_METRIC_SPECS.map((s) => s.term),
  ...STRIP_ONLY_METRIC_TERMS,
];

export const RE_POINTS_OR_UPVOTES = new RegExp(
  `(${COUNT_NUMBER_SOURCE})\\s*(?:points|upvotes?)`,
  "i",
);

/**
 * Primary patterns checked first by extractScore (return-on-first-match) and
 * weighted at 1.0 in the full engagement score. Listed separately from
 * COUNT_METRIC_SPECS because score-label uses a reversed capture format
 * (label:\s*(\d+) instead of (\d+)\s*term).
 */
const PRIMARY_SCORE_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: countMetricRe("points?"), weight: 1 },
  { re: /score:\s*(\d+)/i, weight: 1 },
  { re: countMetricRe("upvotes?"), weight: 1 },
];

export const ENGAGEMENT_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  ...PRIMARY_SCORE_PATTERNS,
  ...COUNT_METRIC_SPECS.slice(2).map((s) => ({ re: countMetricRe(s.term), weight: s.weight })),
];

const RE_STRIP_ENGAGEMENT_METRICS = new RegExp(
  `(?:${COUNT_NUMBER_SOURCE})\\s*(?:${ENGAGEMENT_STRIP_TERMS.join("|")})`,
  "gi",
);

/** Remove numeric engagement suffixes before keyword extraction (cluster, etc.). */
export function stripEngagementMetricCounts(text: string): string {
  return text.replace(RE_STRIP_ENGAGEMENT_METRICS, "");
}

export function extractScore(body: string | null): number {
  if (!body) return 0;
  for (const { re } of PRIMARY_SCORE_PATTERNS) {
    const match = body.match(re);
    if (match) return parseCountGroup(match[1]);
  }
  return 0;
}

export function extractEngagementScore(body: string | null): number {
  if (!body) return 0;
  let total = 0;
  for (const { re, weight } of ENGAGEMENT_PATTERNS) {
    const m = body.match(re);
    if (m) {
      const n = parseCountGroup(m[1]);
      total += Math.floor(n * weight);
    }
  }
  return total;
}

export function parseFirstIntMatch(text: string, re: RegExp): number | undefined {
  const match = text.match(re);
  if (!match) return undefined;
  return parseCountGroup(match[1]);
}

export function formatCount(value: number | string, label: string): string {
  return `${value} ${label}`;
}

export function formatPrefixed(prefix: string, value: string): string {
  return `${prefix}: ${value}`;
}

export function formatLeadIn(leadIn: string, value: string): string {
  return `${leadIn} ${value}`;
}

export function formatSlashPrefixed(prefix: string, name: string): string {
  return `${prefix}/${name}`;
}

export function formatPoints(score: number): string {
  return formatCount(score, "points");
}

export function formatScore(score: number): string {
  return formatPrefixed("Score", String(score));
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function formatComments(count: number): string {
  return formatCount(count, "comments");
}

export function formatAnswers(count: number, accepted = false): string {
  return formatCount(count, accepted ? "answers (accepted)" : "answers");
}

export function formatReactions(count: number): string {
  return formatCount(count, "reactions");
}

export function formatUpvotes(count: number): string {
  return formatCount(count, "upvotes");
}

export function formatBy(author: string): string {
  return formatLeadIn("by", author);
}

export function formatDiscuss(url: string): string {
  return formatPrefixed("discuss", url);
}

export function formatCommunity(name: string): string {
  return formatSlashPrefixed("c", name);
}

export function formatSubreddit(name: string): string {
  return formatSlashPrefixed("r", name);
}

export function formatBoosts(count: number): string {
  return formatCount(count, "boosts");
}

export function formatFavorites(count: number): string {
  return formatCount(count, "favorites");
}

export function formatReplies(count: number): string {
  return formatCount(count, "replies");
}

export function formatReadingTime(minutes: number): string {
  return formatCount(minutes, "min read");
}

export function formatCover(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return formatPrefixed("cover", url);
}

export function formatAtHandle(handle: string, instance?: string): string {
  const normalized = handle.startsWith("@") ? handle.slice(1) : handle;
  if (normalized.includes("@")) {
    return `@${normalized}`;
  }
  if (instance) {
    return `@${normalized}@${instance}`;
  }
  return `@${normalized}`;
}

export function formatMedia(urls: readonly string[]): string | undefined {
  if (urls.length === 0) return undefined;
  return formatPrefixed("media", urls.join(" "));
}

export function formatStars(count: number): string {
  // Pin the locale: host-locale toLocaleString() may emit "12.345" or
  // narrow-space separators, which the count parsers do not recognize.
  return formatCount(count.toLocaleString("en-US"), "stars");
}

const COUNT_SCALES = [
  [1_000_000, 1_000_000, "m"],
  [1_000, 1_000, "k"],
] as const;

function formatScaledCount(n: number): string {
  for (const [threshold, divisor, suffix] of COUNT_SCALES) {
    if (n >= threshold) return `${(n / divisor).toFixed(1)}${suffix}`;
  }
  return String(n);
}

export function formatViews(n: number): string {
  return formatCount(formatScaledCount(n), "views");
}

export function formatLanguage(language: string): string {
  return formatPrefixed("language", language);
}

export function formatTopics(topics: string[]): string {
  return formatPrefixed("topics", topics.join(", "));
}

export function formatTags(tags: readonly string[]): string | undefined {
  if (tags.length === 0) return undefined;
  return formatPrefixed("tags", tags.join(", "));
}

export function formatCategories(categories: string[]): string {
  return formatPrefixed("Categories", categories.join(", "));
}

export function formatSite(url: string): string {
  return formatPrefixed("site", url);
}
