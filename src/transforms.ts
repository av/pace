import type { Model, Api } from "@mariozechner/pi-ai";
import type { TransformConfig, LlmConfig } from "./config";
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
