import { getModel, complete, type Model, type Api, type Context } from "@mariozechner/pi-ai";
import type { LlmConfig } from "./config";
import type { ContentItem } from "./adapters/types";
import { errorMessage } from "./utils";

// Map provider names to their env var for the API key
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

  // For known providers, use getModel
  try {
    const model = getModel(config.provider as any, config.model as any);
    return model as Model<Api>;
  } catch (err) {
    console.warn(
      `llm: unknown provider/model (${config.provider}/${config.model}), using OpenAI-compatible fallback: ${errorMessage(err)}`
    );
    // Unknown provider/model combo — build a custom model for OpenAI-compatible endpoints
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
}

/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) from LLM text responses
 * prior to JSON.parse. Handles optional language tag and surrounding whitespace.
 * This centralizes the repeated fence-stripping logic used by merge/filter/lens wrappers.
 */
export function stripJsonCodeFences(text: string): string {
  return text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
}

/**
 * Safe LLM complete + text extraction with centralized error handling.
 * Returns extracted text or null on any failure (complete reject, bad response, etc).
 * This eliminates the duplicated try/await complete/extractText/catch-return-null
 * (and catch-return-fallback after) pattern across the four wrapper fns.
 */
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
  } catch (err) {
    console.warn(`llm: complete failed: ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Formats a ContentItem as a compact single-line string for inclusion in LLM prompts.
 * Includes id, title, source; optionally a truncated body snippet when maxBodyLen > 0.
 * Used by mergeItems/filterItemsByLlm (with body) and lensItems (no body) to eliminate
 * near-duplicate .map formatting + join logic.
 */
export function formatContentItemForLlm(item: ContentItem, maxBodyLen = 0): string {
  const snippet = maxBodyLen > 0 && item.body ? item.body.slice(0, maxBodyLen) : "";
  return `- id: "${item.id}" | title: "${item.title}" | source: ${item.source}${snippet ? ` | body: ${snippet}` : ""}`;
}

/**
 * Safely parses a JSON response from an LLM after stripping any markdown code fences.
 * Returns the parsed value (cast to T) or null on null input, strip failure, or JSON.parse error.
 * Centralizes the repeated await-safeComplete + null-guard + strip + parse pattern
 * previously duplicated in mergeItems, filterItemsByLlm, and lensItems.
 */
function parseLlmJsonResponse<T>(text: string | null): T | null {
  if (text == null) return null;
  try {
    const jsonStr = stripJsonCodeFences(text);
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    console.warn(`llm: JSON parse failed: ${errorMessage(err)}`);
    return null;
  }
}

/**
 * Single source of truth for the repeated "format item list + build Context with user message + safeComplete + parseLlmJsonResponse"
 * boilerplate duplicated in mergeItems / filterItemsByLlm / lensItems (the 3 batch LLM JSON item processors).
 * Centralizes the query pattern (summarizeItem uses a different per-item prompt, not included).
 */
async function queryLlmForJson<T>(
  model: Model<Api>,
  systemPrompt: string,
  items: ContentItem[],
  maxBodyLen = 0
): Promise<T | null> {
  const itemList = items.map((item) => formatContentItemForLlm(item, maxBodyLen)).join("\n");

  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: itemList, timestamp: Date.now() }],
  };

  const text = await safeComplete(model, context);
  return parseLlmJsonResponse<T>(text);
}

/**
 * Summarize a single content item. Returns a 2-3 sentence summary, or null on error.
 */
export async function summarizeItem(
  model: Model<Api> | null,
  item: ContentItem
): Promise<string | null> {
  if (!model) return null;
  const bodySnippet = item.body ? item.body.slice(0, 2000) : "";
  const userContent = bodySnippet
    ? `Title: ${item.title}\n\n${bodySnippet}`
    : `Title: ${item.title}`;

  const context: Context = {
    systemPrompt:
      "You are a concise summarizer. Provide a 2-3 sentence summary of the given content item. Focus on the key points and why it matters.",
    messages: [{ role: "user", content: userContent, timestamp: Date.now() }],
  };

  const text = await safeComplete(model, context);
  return text;
}

/**
 * LLM-based merge: groups/merges items based on a prompt.
 * Returns structured output: [{merged_ids, title, summary}].
 * Merged items replace originals; unmerged pass through.
 */
export async function mergeItems(
  model: Model<Api> | null,
  items: ContentItem[],
  prompt?: string
): Promise<ContentItem[]> {
  if (!model || items.length === 0) return items;

  const mergePrompt = prompt ?? "Group related items about the same topic into merged summaries";
  const systemPrompt = `${mergePrompt}

Given the content items below, decide which ones to merge together. Return a JSON array where each element is either:
- A merged group: {"merged_ids": ["id1", "id2"], "title": "merged title", "summary": "combined summary"}
- An unchanged item: {"merged_ids": ["id1"], "title": "original title", "summary": null}

Every item ID must appear exactly once. Return ONLY the JSON array.`;

  const groups = await queryLlmForJson<{ merged_ids: string[]; title: string; summary: string | null }[]>(
    model,
    systemPrompt,
    items,
    300
  );
  if (groups == null) return items;

  const itemMap = new Map<string, ContentItem>();
  for (const item of items) itemMap.set(item.id, item);

  const result: ContentItem[] = [];
  for (const group of groups) {
    if (group.merged_ids.length === 1 && !group.summary) {
      const original = itemMap.get(group.merged_ids[0]);
      if (original) result.push(original);
    } else {
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
  }

  return result;
}

/**
 * LLM-based filter: keep only items matching criteria.
 */
export async function filterItemsByLlm(
  model: Model<Api> | null,
  items: ContentItem[],
  criteria: string
): Promise<ContentItem[]> {
  if (!model || items.length === 0) return items;

  const systemPrompt = `Given the criteria: "${criteria}", decide which items to keep. Return a JSON array of item IDs that match. Return ONLY the JSON array of strings.`;

  const keepIds = await queryLlmForJson<string[]>(model, systemPrompt, items, 200);
  if (keepIds == null) return items;

  const keepSet = new Set(keepIds);
  return items.filter((item) => keepSet.has(item.id));
}

/**
 * Lens/rank items by relevance to user interests via LLM scoring.
 * Returns items sorted by relevance score (descending).
 * On error, returns items unchanged (graceful degradation).
 */
export async function lensItems(
  model: Model<Api> | null,
  items: ContentItem[],
  interests: string[]
): Promise<ContentItem[]> {
  if (!model || items.length === 0 || interests.length === 0) return items;

  const interestList = interests.join(", ");
  const systemPrompt = `Score each item's relevance to these interests: ${interestList}. Return a JSON array of {id, score} objects where score is 0-10. Return ONLY the JSON array, no other text.`;

  const scores = await queryLlmForJson<{ id: string; score: number }[]>(model, systemPrompt, items);
  if (scores == null) {
    return items;
  }

  // Build a score map
  const scoreMap = new Map<string, number>();
  for (const { id, score } of scores) {
    scoreMap.set(id, score);
  }

  // Sort items by score descending, unscored items go to the end
  return [...items].sort((a, b) => {
    const sa = scoreMap.get(a.id) ?? -1;
    const sb = scoreMap.get(b.id) ?? -1;
    return sb - sa;
  });
}
