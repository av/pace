import type { TransformConfig } from "./config";
import type { ContentItemRow } from "./db";
import { extractEngagementScore } from "./adapters/engagement";
import { compareIsoTimestamp, errorMessage } from "./utils";

export type SortTransformConfig = Extract<TransformConfig, { type: "sort" }>;

export function applySort(
  items: ContentItemRow[],
  { field, direction }: SortTransformConfig
): ContentItemRow[] {
  const dir = direction === "asc" ? 1 : -1;
  const effectiveDirection = direction ?? "desc";
  return [...items].sort((a, b) => {
    const av = a[field] ?? "";
    const bv = b[field] ?? "";
    if (field === "timestamp") {
      return compareIsoTimestamp(av, bv, effectiveDirection);
    }
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

function parseHalfLife(str: string): number {
  const match = str.trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day|w|wk)s?$/i);
  if (!match) {
    console.warn(`transforms: invalid half_life "${str}", defaulting to 12h`);
    return 12 * 60 * 60 * 1000;
  }
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const MS_MINUTE = 60 * 1000;
  const MS_HOUR = 60 * MS_MINUTE;
  const MS_DAY = 24 * MS_HOUR;
  const MS_WEEK = 7 * MS_DAY;
  switch (unit) {
    case "m":
    case "min":
      return value * MS_MINUTE;
    case "h":
    case "hr":
      return value * MS_HOUR;
    case "d":
    case "day":
      return value * MS_DAY;
    case "w":
    case "wk":
      return value * MS_WEEK;
    default:
      return value * MS_HOUR;
  }
}

function filterByMinScore<T extends { score?: number; finalScore?: number }>(
  scored: T[],
  minScore: number | undefined,
  getScore: (s: T) => number,
  label: string
): T[] {
  if (minScore === undefined) return scored;
  const before = scored.length;
  const filtered = scored.filter((s) => getScore(s) >= minScore);
  if (filtered.length < before) {
    console.log(
      `transforms: ${label} filtered out ${before - filtered.length} item(s) below min_score=${minScore}`
    );
  }
  return filtered;
}

function annotateRow<T extends { body?: string }>(row: T, annotation: string | undefined): T {
  if (!annotation) return row;
  return { ...row, body: (row.body ?? "") + annotation } as T;
}

function sortByScoreDesc<T>(arr: T[], getScore: (x: T) => number): void {
  arr.sort((a, b) => getScore(b) - getScore(a));
}

function finalizeScoredItems<T extends { row: ContentItemRow }>(
  scored: T[],
  {
    minScore,
    getScore,
    filterLabel,
    annotate,
    shouldAnnotate,
    buildAnnotation,
    logMessage,
  }: {
    minScore: number | undefined;
    getScore: (s: T) => number;
    filterLabel: string;
    annotate: boolean;
    shouldAnnotate?: (s: T) => boolean;
    buildAnnotation: (s: T) => string;
    logMessage: (filtered: T[], result: ContentItemRow[]) => string;
  }
): ContentItemRow[] {
  const filtered = filterByMinScore(scored, minScore, getScore, filterLabel);
  sortByScoreDesc(filtered, getScore);

  const result = filtered.map((s) => {
    if (annotate && (shouldAnnotate?.(s) ?? true)) {
      return annotateRow(s.row, buildAnnotation(s));
    }
    return s.row;
  });

  console.log(logMessage(filtered, result));
  return result;
}

export type KeywordScoreTransformConfig = Extract<TransformConfig, { type: "keyword-score" }>;

export function applyKeywordScore(
  items: ContentItemRow[],
  { keywords, min_score: minScore, annotate = false }: KeywordScoreTransformConfig
): ContentItemRow[] {
  if (keywords.length === 0) return items;

  const matchers = keywords.map((kw) => {
    if (kw.regex) {
      try {
        return { regex: new RegExp(kw.term, "gi"), weight: kw.weight, term: kw.term };
      } catch (err) {
        console.warn(
          `transforms: invalid keyword-score regex "${kw.term}": ${errorMessage(err)}, treating as literal`,
        );
        return { regex: null, literal: kw.term.toLowerCase(), weight: kw.weight, term: kw.term };
      }
    }
    return { regex: null, literal: kw.term.toLowerCase(), weight: kw.weight, term: kw.term };
  });

  interface ScoredItem {
    row: ContentItemRow;
    score: number;
    matchedTerms: string[];
  }

  const scored: ScoredItem[] = items.map((item) => {
    const title = (item.title ?? "").toLowerCase();
    const body = (item.body ?? "").toLowerCase();
    const titleOrig = item.title ?? "";
    const bodyOrig = item.body ?? "";
    let score = 0;
    const matchedTerms: string[] = [];

    for (const matcher of matchers) {
      let matchCount = 0;

      if (matcher.regex) {
        matcher.regex.lastIndex = 0;
        const titleMatches = titleOrig.match(matcher.regex);
        const bodyMatches = bodyOrig.match(matcher.regex);
        matchCount = (titleMatches?.length ?? 0) + (bodyMatches?.length ?? 0);
      } else {
        const literal = matcher.literal!;
        let idx = 0;
        while ((idx = title.indexOf(literal, idx)) !== -1) {
          matchCount++;
          idx += literal.length;
        }
        idx = 0;
        while ((idx = body.indexOf(literal, idx)) !== -1) {
          matchCount++;
          idx += literal.length;
        }
      }

      if (matchCount > 0) {
        score += matcher.weight * matchCount;
        matchedTerms.push(`${matcher.term}(${matchCount > 1 ? "x" + matchCount : ""}${matcher.weight > 0 ? "+" : ""}${matcher.weight})`);
      }
    }

    return { row: item, score, matchedTerms };
  });

  return finalizeScoredItems(scored, {
    minScore,
    getScore: (s) => s.score,
    filterLabel: "keyword-score",
    annotate,
    shouldAnnotate: (s) => s.matchedTerms.length > 0,
    buildAnnotation: (s) => `\n---\n[keyword-score: ${s.score}] ${s.matchedTerms.join(", ")}`,
    logMessage: (filtered, result) =>
      `transforms: keyword-score scored ${items.length} items, ${result.length} passed` +
      (result.length > 0
        ? ` (top score: ${filtered[0]?.score}, bottom: ${filtered[filtered.length - 1]?.score})`
        : ""),
  });
}

export type TimeDecayTransformConfig = Extract<TransformConfig, { type: "time-decay" }>;

export function applyTimeDecay(
  items: ContentItemRow[],
  {
    half_life: halfLifeStr = "12h",
    engagement_weight: engagementWeight = 0.7,
    recency_weight: recencyWeight = 0.3,
    decay: decayType = "exponential",
    annotate = false,
    min_score: minScore,
  }: TimeDecayTransformConfig
): ContentItemRow[] {
  const halfLifeMs = parseHalfLife(halfLifeStr);
  const now = Date.now();

  const engagementScores = items.map((item) => extractEngagementScore(item.body));
  const maxEngagement = Math.max(1, ...engagementScores);

  interface DecayScored {
    row: ContentItemRow;
    engagementNorm: number;
    recencyNorm: number;
    finalScore: number;
  }

  const scored: DecayScored[] = items.map((item, i) => {
    const rawEngagement = engagementScores[i];
    const engagementNorm = maxEngagement > 1
      ? Math.log(1 + rawEngagement) / Math.log(1 + maxEngagement)
      : (rawEngagement > 0 ? 1 : 0);

    const itemTime = new Date(item.timestamp).getTime();
    const ageMs = Math.max(0, now - itemTime);

    let recencyNorm: number;
    if (decayType === "exponential") {
      recencyNorm = Math.pow(2, -(ageMs / halfLifeMs));
    } else {
      recencyNorm = Math.max(0, 1 - ageMs / (2 * halfLifeMs));
    }

    const finalScore = engagementWeight * engagementNorm + recencyWeight * recencyNorm;
    return { row: item, engagementNorm, recencyNorm, finalScore };
  });

  return finalizeScoredItems(scored, {
    minScore,
    getScore: (s) => s.finalScore,
    filterLabel: "time-decay",
    annotate,
    buildAnnotation: (s) =>
      `\n---\n[hot-score: ${s.finalScore.toFixed(3)}] engagement=${s.engagementNorm.toFixed(3)} recency=${s.recencyNorm.toFixed(3)} (${decayType}, half_life=${halfLifeStr})`,
    logMessage: (filtered, result) =>
      `transforms: time-decay ranked ${items.length} items (decay=${decayType}, half_life=${halfLifeStr}, weights=${engagementWeight}/${recencyWeight})` +
      (result.length > 0
        ? ` top=${filtered[0]?.finalScore.toFixed(3)}, bottom=${filtered[filtered.length - 1]?.finalScore.toFixed(3)}`
        : ""),
  });
}