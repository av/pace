import {
  getModels,
  getProviders,
  complete,
  type KnownProvider,
  type Model,
  type Api,
  type Context,
} from "@mariozechner/pi-ai";
import type { LlmConfig } from "./config/types";
import type { ContentItem } from "./adapters/types";
import { capText } from "./adapters/title";
import { warnLlm } from "./llm-warn";

const KNOWN_PROVIDERS = new Set<string>(getProviders());

function isKnownProvider(provider: string): provider is KnownProvider {
  return KNOWN_PROVIDERS.has(provider);
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_API_KEY",
  "google-vertex": "GOOGLE_API_KEY",
  groq: "GROQ_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

/**
 * Create a pi-ai Model from config. Returns null if config is incomplete.
 */
export function createModel(config: LlmConfig): Model<Api> | null {
  if (!config.provider || !config.model || !config.api_key) return null;

  const envKey = PROVIDER_ENV_KEYS[config.provider];
  if (envKey) {
    process.env[envKey] = config.api_key;
  }

  if (isKnownProvider(config.provider)) {
    const model = getModels(config.provider).find((m) => m.id === config.model);
    if (model) return model;
  }

  warnLlm(
    `unknown provider/model (${config.provider}/${config.model}), using OpenAI-compatible fallback`
  );
  const customModel: Model<"openai-completions"> = {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: config.provider,
    baseUrl: config.base_url ?? "http://localhost:11434/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
  return customModel as Model<Api>;
}

/** Strip markdown code fences before JSON.parse. */
export function stripJsonCodeFences(text: string): string {
  return text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
}

/** complete() + text blocks; null on failure. */
export async function safeComplete(
  model: Model<Api>,
  context: Context
): Promise<string | null> {
  try {
    const response = await complete(model, context);
    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text || null;
  } catch (err: unknown) {
    warnLlm("complete failed", err);
    return null;
  }
}

/** One-line item summary for batch LLM prompts. */
export function formatContentItemForLlm(
  item: ContentItem,
  maxBodyLen = 0,
  fetchedContent?: string,
): string {
  const snippet = maxBodyLen > 0 && item.body ? capText(item.body, maxBodyLen) : "";
  const contentSnippet = fetchedContent ? capText(fetchedContent, 2000) : "";
  return (
    `- id: "${item.id}" | title: "${item.title}" | source: ${item.source}` +
    (snippet ? ` | body: ${snippet}` : "") +
    (contentSnippet ? ` | content: ${contentSnippet}` : "")
  );
}

function parseLlmJsonResponse<T>(text: string | null): T | null {
  if (text == null) return null;
  try {
    const jsonStr = stripJsonCodeFences(text);
    return JSON.parse(jsonStr) as T;
  } catch (err: unknown) {
    warnLlm("JSON parse failed", err);
    return null;
  }
}

/** Skip merge/filter/lens when there is no model or nothing to process. */
function shouldPassthroughLlmBatch(
  model: Model<Api> | null,
  items: ContentItem[]
): boolean {
  return !model || items.length === 0;
}

async function queryLlmForJson<T>(
  model: Model<Api>,
  systemPrompt: string,
  items: ContentItem[],
  maxBodyLen = 0,
  fetchedContent?: Map<string, string>,
): Promise<T | null> {
  const itemList = items
    .map((item) => formatContentItemForLlm(item, maxBodyLen, fetchedContent?.get(item.id)))
    .join("\n");

  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: itemList, timestamp: Date.now() }],
  };

  const text = await safeComplete(model, context);
  return parseLlmJsonResponse<T>(text);
}

/** Query LLM for JSON and map results; passthrough on skip, empty batch, or failure. */
async function runLlmBatchTransform<T>(
  model: Model<Api> | null,
  items: ContentItem[],
  systemPrompt: string,
  applyResult: (result: T, items: ContentItem[]) => ContentItem[],
  options?: { maxBodyLen?: number; skip?: boolean; fetchedContent?: Map<string, string> },
): Promise<ContentItem[]> {
  if (shouldPassthroughLlmBatch(model, items) || options?.skip) return items;

  const result = await queryLlmForJson<T>(
    model!,
    systemPrompt,
    items,
    options?.maxBodyLen ?? 0,
    options?.fetchedContent,
  );
  if (result == null) return items;

  return applyResult(result, items);
}

type SummaryEntry = { id: string; summary: string };

function applySummaryEntries(entries: SummaryEntry[], items: ContentItem[]): ContentItem[] {
  const summaryMap = new Map(entries.map((entry) => [entry.id, entry.summary]));
  return items.map((item) => {
    const summary = summaryMap.get(item.id);
    return summary ? { ...item, summary } : item;
  });
}

/** Batch summarize via single LLM JSON call; unchanged items pass through on skip or failure. */
export async function summarizeItems(
  model: Model<Api> | null,
  items: ContentItem[],
  fetchedContent?: Map<string, string>,
): Promise<ContentItem[]> {
  const systemPrompt =
    "You are a concise summarizer. For each content item below, provide a 2-3 sentence summary focusing on key points and why it matters. Return a JSON array of {\"id\": \"...\", \"summary\": \"...\"} objects. Every item ID must appear exactly once. Return ONLY the JSON array.";

  return runLlmBatchTransform(model, items, systemPrompt, applySummaryEntries, { maxBodyLen: 2000, fetchedContent });
}

/** 2–3 sentence summary, or null on error. */
export async function summarizeItem(
  model: Model<Api> | null,
  item: ContentItem
): Promise<string | null> {
  if (!model) return null;
  const [result] = await summarizeItems(model, [item]);
  return result.summary ?? null;
}

type MergeGroup = { merged_ids: string[]; title: string; summary: string | null };

function applyMergeGroups(groups: MergeGroup[], items: ContentItem[]): ContentItem[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const result: ContentItem[] = [];

  for (const group of groups) {
    if (group.merged_ids.length === 1 && !group.summary) {
      const original = itemMap.get(group.merged_ids[0]);
      if (original) result.push(original);
      continue;
    }

    const firstItem = itemMap.get(group.merged_ids[0]);
    result.push({
      id: group.merged_ids.join("+"),
      title: group.title,
      url: firstItem?.url ?? "",
      source: firstItem?.source ?? "merged",
      timestamp: firstItem?.timestamp ?? new Date(),
      body: group.summary ?? undefined,
    });
  }

  return result;
}

/** LLM merge by prompt; unchanged items pass through on failure. */
export async function mergeItems(
  model: Model<Api> | null,
  items: ContentItem[],
  prompt?: string
): Promise<ContentItem[]> {
  const mergePrompt = prompt ?? "Group related items about the same topic into merged summaries";
  const systemPrompt = `${mergePrompt}

Given the content items below, decide which ones to merge together. Return a JSON array where each element is either:
- A merged group: {"merged_ids": ["id1", "id2"], "title": "merged title", "summary": "combined summary"}
- An unchanged item: {"merged_ids": ["id1"], "title": "original title", "summary": null}

Every item ID must appear exactly once. Return ONLY the JSON array.`;

  return runLlmBatchTransform(model, items, systemPrompt, applyMergeGroups, { maxBodyLen: 300 });
}

/** LLM filter by criteria string; unchanged on failure. */
export async function filterItemsByLlm(
  model: Model<Api> | null,
  items: ContentItem[],
  criteria: string
): Promise<ContentItem[]> {
  const systemPrompt = `Given the criteria: "${criteria}", decide which items to keep. Return a JSON array of item IDs that match. Return ONLY the JSON array of strings.`;

  return runLlmBatchTransform(
    model,
    items,
    systemPrompt,
    (keepIds, sourceItems) => {
      const keepSet = new Set(keepIds);
      return sourceItems.filter((item) => keepSet.has(item.id));
    },
    { maxBodyLen: 200 },
  );
}

/** Rank by LLM relevance scores; unchanged on failure. */
export async function lensItems(
  model: Model<Api> | null,
  items: ContentItem[],
  interests: string[]
): Promise<ContentItem[]> {
  const { items: ranked } = await lensItemsWithScores(model, items, interests);
  return ranked;
}

type ScoreEntry = { id: string; score: number };

/**
 * Rank items by LLM relevance and return both the sorted list and the raw score map.
 * scoreMap is empty on failure or when interests is empty.
 */
export async function lensItemsWithScores(
  model: Model<Api> | null,
  items: ContentItem[],
  interests: string[]
): Promise<{ items: ContentItem[]; scoreMap: Map<string, number> }> {
  const interestList = interests.join(", ");
  const systemPrompt = `Score each item's relevance to these interests: ${interestList}. Return a JSON array of {id, score} objects where score is 0-10. Return ONLY the JSON array, no other text.`;

  let scoreMap = new Map<string, number>();

  const ranked = await runLlmBatchTransform<ScoreEntry[]>(
    model,
    items,
    systemPrompt,
    (scores, sourceItems) => {
      scoreMap = new Map(scores.map(({ id, score }) => [id, score]));
      return [...sourceItems].sort((a, b) => {
        const sa = scoreMap.get(a.id) ?? -1;
        const sb = scoreMap.get(b.id) ?? -1;
        return sb - sa;
      });
    },
    { skip: interests.length === 0 },
  );

  return { items: ranked, scoreMap };
}
