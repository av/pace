export const RE_POINTS = /(\d+)\s*points?/i;
export const RE_SCORE_LABEL = /score:\s*(\d+)/i;
export const RE_UPVOTES = /(\d+)\s*upvotes?/i;
export const RE_POINTS_OR_UPVOTES = /(\d+)\s*(?:points|upvotes?)/i;

export const ENGAGEMENT_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: RE_POINTS, weight: 1 },
  { re: RE_SCORE_LABEL, weight: 1 },
  { re: RE_UPVOTES, weight: 1 },
  { re: /(\d+)\s*boosts?/i, weight: 1 },
  { re: /(\d+)\s*favou?rites?/i, weight: 1 },
  { re: /(\d+)\s*stars?/i, weight: 1 },
  { re: /(\d+)\s*likes?/i, weight: 1 },
  { re: /(\d+)\s*comments?/i, weight: 0.5 },
];

const PRIMARY_SCORE_PATTERNS: RegExp[] = ENGAGEMENT_PATTERNS.slice(0, 3).map(({ re }) => re);

export function extractScore(body: string | null): number {
  if (!body) return 0;
  for (const re of PRIMARY_SCORE_PATTERNS) {
    const match = body.match(re);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

export function extractEngagementScore(body: string | null): number {
  if (!body) return 0;
  let total = 0;
  for (const { re, weight } of ENGAGEMENT_PATTERNS) {
    const m = body.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      total += Math.floor(n * weight);
    }
  }
  return total;
}

export function parseFirstIntMatch(text: string, re: RegExp): number | undefined {
  const match = text.match(re);
  if (!match) return undefined;
  return parseInt(match[1], 10);
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

export function formatMastodonAcct(acct: string, instance: string): string {
  if (acct.includes("@")) {
    return `@${acct}`;
  }
  return `@${acct}@${instance}`;
}

export function formatMedia(urls: readonly string[]): string | undefined {
  if (urls.length === 0) return undefined;
  return formatPrefixed("media", urls.join(" "));
}

export function formatStars(count: number): string {
  return formatCount(count.toLocaleString(), "stars");
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
