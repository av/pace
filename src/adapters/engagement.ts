import { joinTitle } from "./title";

/** Primary vote/score signals (HN, Lobsters, Reddit, Product Hunt enrich). */
export const RE_POINTS = /(\d+)\s*points?/i;
export const RE_SCORE_LABEL = /score:\s*(\d+)/i;
export const RE_UPVOTES = /(\d+)\s*upvotes?/i;
/** Product Hunt enrich HTML accepts points or upvotes wording. */
export const RE_POINTS_OR_UPVOTES = /(\d+)\s*(?:points|upvotes?)/i;

const PRIMARY_SCORE_PATTERNS: RegExp[] = [RE_POINTS, RE_SCORE_LABEL, RE_UPVOTES];

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

/** First matching primary score in body text (dedupe keep:highest-score). */
export function extractScore(body: string | null): number {
  if (!body) return 0;
  for (const re of PRIMARY_SCORE_PATTERNS) {
    const match = body.match(re);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

/** Weighted sum of engagement signals in body metadata (time-decay, cluster sort). */
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

export function formatPoints(score: number): string {
  return `${score} points`;
}

/** Stack Exchange and other APIs that expose vote count as "Score: N". */
export function formatScore(score: number): string {
  return `Score: ${score}`;
}

/** Fractional scores (e.g. npm registry 0–1) as a rounded percent string. */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function formatComments(count: number): string {
  return `${count} comments`;
}

export function formatReactions(count: number): string {
  return `${count} reactions`;
}

export function formatUpvotes(count: number): string {
  return `${count} upvotes`;
}

export function formatBy(author: string): string {
  return `by ${author}`;
}

export function formatDiscuss(url: string): string {
  return `discuss: ${url}`;
}

export function formatBoosts(count: number): string {
  return `${count} boosts`;
}

export function formatFavorites(count: number): string {
  return `${count} favorites`;
}

export function formatReplies(count: number): string {
  return `${count} replies`;
}

/** Join adapter body segments with " | ". */
export const joinBodyParts = joinTitle;