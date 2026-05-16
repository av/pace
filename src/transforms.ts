import type { Model, Api } from "@mariozechner/pi-ai";
import type { TransformConfig, LlmConfig, KeywordScoreEntry } from "./config";
import type { ContentItemRow } from "./db";
import type { ContentItem } from "./adapters/types";
import { summarizeItem, lensItems, mergeItems, filterItemsByLlm } from "./llm";
import {
  normalizeUrl,
  levenshteinSimilarity,
  extractScore,
  type DedupeStrategy,
} from "./dedupe";

export interface TransformContext {
  llmModel: Model<Api> | null;
  llmConfig?: LlmConfig;
}

function rowToContentItem(row: ContentItemRow): ContentItem {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    timestamp: new Date(row.timestamp),
    body: row.body ?? undefined,
  };
}

function contentItemToRow(item: ContentItem, base?: ContentItemRow): ContentItemRow {
  return {
    id: item.id,
    adapter_name: base?.adapter_name ?? "merged",
    title: item.title,
    url: item.url,
    source: item.source,
    body: item.body ?? null,
    timestamp: item.timestamp.toISOString(),
    fetched_at: base?.fetched_at ?? new Date().toISOString(),
    summary: base?.summary ?? (item.body ?? null),
  };
}

function pickWinner(
  group: ContentItemRow[],
  keep: "highest-score" | "earliest" | "latest"
): ContentItemRow {
  if (group.length === 1) return group[0];
  if (keep === "earliest") {
    return group.reduce((a, b) => (a.timestamp <= b.timestamp ? a : b));
  }
  if (keep === "latest") {
    return group.reduce((a, b) => (a.timestamp >= b.timestamp ? a : b));
  }
  // highest-score: extract score from body metadata, fall back to earliest
  let best = group[0];
  let bestScore = extractScore(best.body);
  for (let i = 1; i < group.length; i++) {
    const score = extractScore(group[i].body);
    if (score > bestScore) {
      best = group[i];
      bestScore = score;
    }
  }
  // If all scores are 0 (no score info), fall back to earliest
  if (bestScore === 0) {
    return group.reduce((a, b) => (a.timestamp <= b.timestamp ? a : b));
  }
  return best;
}

/**
 * Parse a human-readable duration string into milliseconds.
 * Supports: "30m", "6h", "12h", "1d", "3d", "1w", "2w" etc.
 */
function parseHalfLife(str: string): number {
  const match = str.trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day|w|wk)s?$/i);
  if (!match) {
    console.warn(`[time-decay] invalid half_life "${str}", defaulting to 12h`);
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

/**
 * Extract a numeric engagement score from body metadata.
 * Parses patterns like "N points", "N boosts", "N stars", "N favorites", "N upvotes", etc.
 * Similar to extractScore from dedupe.ts but broader in scope.
 */
function extractEngagementScore(body: string | null): number {
  if (!body) return 0;
  let total = 0;

  // Match "N points" (HN, Lobsters)
  const pointsMatch = body.match(/(\d+)\s*points?/i);
  if (pointsMatch) total += parseInt(pointsMatch[1], 10);

  // Match "score: N"
  const scoreMatch = body.match(/score:\s*(\d+)/i);
  if (scoreMatch) total += parseInt(scoreMatch[1], 10);

  // Match "N upvotes"
  const upvotesMatch = body.match(/(\d+)\s*upvotes?/i);
  if (upvotesMatch) total += parseInt(upvotesMatch[1], 10);

  // Match "N boosts" (Mastodon/Fediverse)
  const boostsMatch = body.match(/(\d+)\s*boosts?/i);
  if (boostsMatch) total += parseInt(boostsMatch[1], 10);

  // Match "N favorites" / "N favourites" (Mastodon/Fediverse)
  const favMatch = body.match(/(\d+)\s*favou?rites?/i);
  if (favMatch) total += parseInt(favMatch[1], 10);

  // Match "N stars" (GitHub)
  const starsMatch = body.match(/(\d+)\s*stars?/i);
  if (starsMatch) total += parseInt(starsMatch[1], 10);

  // Match "N likes"
  const likesMatch = body.match(/(\d+)\s*likes?/i);
  if (likesMatch) total += parseInt(likesMatch[1], 10);

  // Match "N comments" as a secondary signal (weighted lower — add half)
  const commentsMatch = body.match(/(\d+)\s*comments?/i);
  if (commentsMatch) total += Math.floor(parseInt(commentsMatch[1], 10) / 2);

  return total;
}

type TransformFn = (
  items: ContentItemRow[],
  config: TransformConfig,
  ctx: TransformContext
) => Promise<ContentItemRow[]>;

const transforms: Record<string, TransformFn> = {
  latest: async (items, config) => {
    const { count } = config as { type: "latest"; count: number };
    return items.slice(0, count);
  },

  filter: async (items, config) => {
    const { keywords, fields } = config as {
      type: "filter";
      keywords: string[];
      fields?: ("title" | "body" | "source")[];
    };
    const checkFields = fields ?? ["title", "body"];
    const lowerKeywords = keywords.map((k) => k.toLowerCase());
    return items.filter((item) =>
      lowerKeywords.some((kw) =>
        checkFields.some((f) => {
          const val = item[f];
          return val ? val.toLowerCase().includes(kw) : false;
        })
      )
    );
  },

  exclude: async (items, config) => {
    const { keywords, fields } = config as {
      type: "exclude";
      keywords: string[];
      fields?: ("title" | "body" | "source")[];
    };
    const checkFields = fields ?? ["title", "body"];
    const lowerKeywords = keywords.map((k) => k.toLowerCase());
    return items.filter(
      (item) =>
        !lowerKeywords.some((kw) =>
          checkFields.some((f) => {
            const val = item[f];
            return val ? val.toLowerCase().includes(kw) : false;
          })
        )
    );
  },

  sort: async (items, config) => {
    const { field, direction } = config as {
      type: "sort";
      field: "timestamp" | "title" | "source";
      direction?: "asc" | "desc";
    };
    const dir = direction === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const av = a[field] ?? "";
      const bv = b[field] ?? "";
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  },

  dedupe: async (items, config) => {
    const cfg = config as {
      type: "dedupe";
      strategy?: DedupeStrategy;
      threshold?: number;
      keep?: "highest-score" | "earliest" | "latest";
      log?: boolean;
    };
    const strategy = cfg.strategy ?? "url";
    const threshold = cfg.threshold ?? 0.85;
    const keep = cfg.keep ?? "highest-score";
    const shouldLog = cfg.log !== false; // log by default

    if (strategy === "url") {
      // Simple exact URL dedup
      const seen = new Set<string>();
      const removed: string[] = [];
      const result = items.filter((item) => {
        if (!item.url || seen.has(item.url)) {
          if (item.url) removed.push(`"${item.title}" (${item.url})`);
          return false;
        }
        seen.add(item.url);
        return true;
      });
      if (shouldLog && removed.length > 0) {
        console.log(`[dedupe:url] removed ${removed.length} duplicate(s):`);
        for (const r of removed.slice(0, 10)) console.log(`  - ${r}`);
        if (removed.length > 10) console.log(`  ... and ${removed.length - 10} more`);
      }
      return result;
    }

    if (strategy === "domain-normalized") {
      // Normalize URLs then dedup
      const groups = new Map<string, ContentItemRow[]>();
      for (const item of items) {
        const key = normalizeUrl(item.url);
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
      }
      const result: ContentItemRow[] = [];
      const removed: string[] = [];
      for (const [, group] of groups) {
        const winner = pickWinner(group, keep);
        result.push(winner);
        for (const item of group) {
          if (item !== winner) {
            removed.push(`"${item.title}" (${item.url}) -> kept "${winner.title}"`);
          }
        }
      }
      if (shouldLog && removed.length > 0) {
        console.log(`[dedupe:domain-normalized] removed ${removed.length} duplicate(s):`);
        for (const r of removed.slice(0, 10)) console.log(`  - ${r}`);
        if (removed.length > 10) console.log(`  ... and ${removed.length - 10} more`);
      }
      // Preserve original ordering based on first occurrence
      const orderMap = new Map<string, number>();
      items.forEach((item, i) => { if (!orderMap.has(item.id)) orderMap.set(item.id, i); });
      return result.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    }

    if (strategy === "title-similarity") {
      // Fuzzy title matching using Levenshtein similarity
      const kept: ContentItemRow[] = [];
      const removed: string[] = [];
      for (const item of items) {
        let isDuplicate = false;
        for (const existing of kept) {
          const similarity = levenshteinSimilarity(
            item.title.toLowerCase(),
            existing.title.toLowerCase()
          );
          if (similarity >= threshold) {
            // Found a near-duplicate — decide which to keep
            const winner = pickWinner([existing, item], keep);
            if (winner === item) {
              // Replace existing with current item
              const idx = kept.indexOf(existing);
              kept[idx] = item;
              removed.push(
                `"${existing.title}" (sim=${similarity.toFixed(2)}) -> kept "${item.title}"`
              );
            } else {
              removed.push(
                `"${item.title}" (sim=${similarity.toFixed(2)}) -> kept "${existing.title}"`
              );
            }
            isDuplicate = true;
            break;
          }
        }
        if (!isDuplicate) {
          kept.push(item);
        }
      }
      if (shouldLog && removed.length > 0) {
        console.log(`[dedupe:title-similarity] removed ${removed.length} duplicate(s) (threshold=${threshold}):`);
        for (const r of removed.slice(0, 10)) console.log(`  - ${r}`);
        if (removed.length > 10) console.log(`  ... and ${removed.length - 10} more`);
      }
      return kept;
    }

    // Fallback for unknown strategy
    console.warn(`[dedupe] unknown strategy "${strategy}", passing items through`);
    return items;
  },

  "keyword-score": async (items, config) => {
    const cfg = config as {
      type: "keyword-score";
      keywords: KeywordScoreEntry[];
      min_score?: number;
      annotate?: boolean;
    };
    const keywords = cfg.keywords ?? [];
    const minScore = cfg.min_score ?? undefined;
    const annotate = cfg.annotate ?? false;

    if (keywords.length === 0) return items;

    // Pre-compile regex patterns for regex entries, plain lowercase strings for others
    const matchers = keywords.map((kw) => {
      if (kw.regex) {
        try {
          return { regex: new RegExp(kw.term, "gi"), weight: kw.weight, term: kw.term };
        } catch {
          console.warn(`[keyword-score] invalid regex "${kw.term}", treating as literal`);
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
          // Reset lastIndex for global regex
          matcher.regex.lastIndex = 0;
          const titleMatches = titleOrig.match(matcher.regex);
          const bodyMatches = bodyOrig.match(matcher.regex);
          matchCount = (titleMatches?.length ?? 0) + (bodyMatches?.length ?? 0);
        } else {
          // Case-insensitive literal matching - count occurrences
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

    // Filter by minimum score if specified
    let filtered = scored;
    if (minScore !== undefined) {
      const before = filtered.length;
      filtered = filtered.filter((s) => s.score >= minScore);
      if (filtered.length < before) {
        console.log(
          `[keyword-score] filtered out ${before - filtered.length} item(s) below min_score=${minScore}`
        );
      }
    }

    // Sort by score descending (stable: items with same score keep original order)
    filtered.sort((a, b) => b.score - a.score);

    // Annotate items with matched keywords if requested
    const result = filtered.map((s) => {
      if (annotate && s.matchedTerms.length > 0) {
        const annotation = `\n---\n[keyword-score: ${s.score}] ${s.matchedTerms.join(", ")}`;
        return { ...s.row, body: (s.row.body ?? "") + annotation };
      }
      return s.row;
    });

    console.log(
      `[keyword-score] scored ${items.length} items, ${result.length} passed` +
        (result.length > 0
          ? ` (top score: ${filtered[0]?.score}, bottom: ${filtered[filtered.length - 1]?.score})`
          : "")
    );

    return result;
  },

  "time-decay": async (items, config) => {
    const cfg = config as {
      type: "time-decay";
      half_life?: string;
      engagement_weight?: number;
      recency_weight?: number;
      decay?: "exponential" | "linear";
      annotate?: boolean;
      min_score?: number;
    };

    const halfLifeStr = cfg.half_life ?? "12h";
    const engagementWeight = cfg.engagement_weight ?? 0.7;
    const recencyWeight = cfg.recency_weight ?? 0.3;
    const decayType = cfg.decay ?? "exponential";
    const annotate = cfg.annotate ?? false;
    const minScore = cfg.min_score ?? undefined;

    // Parse half-life string into milliseconds
    const halfLifeMs = parseHalfLife(halfLifeStr);

    const now = Date.now();

    // Compute engagement scores and find the max for normalization
    const engagementScores = items.map((item) => extractEngagementScore(item.body));
    const maxEngagement = Math.max(1, ...engagementScores); // avoid division by zero

    // Compute time-decay scores
    interface DecayScored {
      row: ContentItemRow;
      engagementNorm: number;
      recencyNorm: number;
      finalScore: number;
    }

    const scored: DecayScored[] = items.map((item, i) => {
      // Normalize engagement to [0, 1] using log scale for better distribution
      const rawEngagement = engagementScores[i];
      const engagementNorm = maxEngagement > 1
        ? Math.log(1 + rawEngagement) / Math.log(1 + maxEngagement)
        : (rawEngagement > 0 ? 1 : 0);

      // Compute age in ms
      const itemTime = new Date(item.timestamp).getTime();
      const ageMs = Math.max(0, now - itemTime);

      // Compute recency score via decay function
      let recencyNorm: number;
      if (decayType === "exponential") {
        // Exponential decay: score = 2^(-age / half_life)
        recencyNorm = Math.pow(2, -(ageMs / halfLifeMs));
      } else {
        // Linear decay: score = max(0, 1 - age / (2 * half_life))
        // Items older than 2x half-life get score 0
        recencyNorm = Math.max(0, 1 - ageMs / (2 * halfLifeMs));
      }

      // Combined weighted score
      const finalScore = engagementWeight * engagementNorm + recencyWeight * recencyNorm;

      return { row: item, engagementNorm, recencyNorm, finalScore };
    });

    // Filter by minimum score if specified
    let filtered = scored;
    if (minScore !== undefined) {
      const before = filtered.length;
      filtered = filtered.filter((s) => s.finalScore >= minScore);
      if (filtered.length < before) {
        console.log(
          `[time-decay] filtered out ${before - filtered.length} item(s) below min_score=${minScore}`
        );
      }
    }

    // Sort by final score descending (stable sort preserves order for ties)
    filtered.sort((a, b) => b.finalScore - a.finalScore);

    // Annotate items with computed scores if requested
    const result = filtered.map((s) => {
      if (annotate) {
        const annotation = `\n---\n[hot-score: ${s.finalScore.toFixed(3)}] engagement=${s.engagementNorm.toFixed(3)} recency=${s.recencyNorm.toFixed(3)} (${decayType}, half_life=${halfLifeStr})`;
        return { ...s.row, body: (s.row.body ?? "") + annotation };
      }
      return s.row;
    });

    console.log(
      `[time-decay] ranked ${items.length} items (decay=${decayType}, half_life=${halfLifeStr}, weights=${engagementWeight}/${recencyWeight})` +
        (result.length > 0
          ? ` top=${filtered[0]?.finalScore.toFixed(3)}, bottom=${filtered[filtered.length - 1]?.finalScore.toFixed(3)}`
          : "")
    );

    return result;
  },

  "llm-summarize": async (items, _config, ctx) => {
    if (!ctx.llmModel) return items;
    const results: ContentItemRow[] = [];
    for (const item of items) {
      if (item.summary) {
        results.push(item);
        continue;
      }
      const summary = await summarizeItem(ctx.llmModel, rowToContentItem(item));
      results.push({ ...item, summary: summary ?? item.summary });
    }
    return results;
  },

  "llm-filter": async (items, config, ctx) => {
    if (!ctx.llmModel) return items;
    const { criteria } = config as { type: "llm-filter"; criteria: string };
    const contentItems = items.map(rowToContentItem);
    const filtered = await filterItemsByLlm(ctx.llmModel, contentItems, criteria);
    const keepIds = new Set(filtered.map((i) => i.id));
    return items.filter((row) => keepIds.has(row.id));
  },

  "llm-rank": async (items, config, ctx) => {
    if (!ctx.llmModel) return items;
    const { interests } = config as { type: "llm-rank"; interests?: string[] };
    const effectiveInterests = interests ?? ctx.llmConfig?.interests ?? [];
    if (effectiveInterests.length === 0) return items;
    const contentItems = items.map(rowToContentItem);
    const ranked = await lensItems(ctx.llmModel, contentItems, effectiveInterests);
    const orderMap = new Map<string, number>();
    ranked.forEach((item, i) => orderMap.set(item.id, i));
    return [...items].sort(
      (a, b) => (orderMap.get(a.id) ?? items.length) - (orderMap.get(b.id) ?? items.length)
    );
  },

  "llm-merge": async (items, config, ctx) => {
    if (!ctx.llmModel) return items;
    const { prompt } = config as { type: "llm-merge"; prompt?: string };
    const contentItems = items.map(rowToContentItem);
    const merged = await mergeItems(ctx.llmModel, contentItems, prompt);
    const rowMap = new Map<string, ContentItemRow>();
    for (const row of items) rowMap.set(row.id, row);
    return merged.map((item) => {
      const baseRow = rowMap.get(item.id) ?? rowMap.get(item.id.split("+")[0]);
      return contentItemToRow(item, baseRow);
    });
  },
};

export async function runPipeline(
  items: ContentItemRow[],
  pipeline: TransformConfig[],
  ctx: TransformContext
): Promise<ContentItemRow[]> {
  let result = items;
  for (const config of pipeline) {
    const fn = transforms[config.type];
    if (!fn) {
      console.warn(`transforms: unknown transform type "${config.type}", skipping`);
      continue;
    }
    result = await fn(result, config, ctx);
  }
  return result;
}
