import {
  getModels,
  getProviders,
  complete,
  type KnownProvider,
  type Model,
  type Api,
  type Context,
} from "@mariozechner/pi-ai";
import type { LlmConfig } from "./config";
import type { ContentItem } from "./adapters/types";
import { errorMessage } from "./utils";

const KNOWN_PROVIDERS = new Set<string>(getProviders());

function warnLlm(message: string, err?: unknown): void {
  console.warn(err !== undefined ? `llm: ${message}: ${errorMessage(err)}` : `llm: ${message}`);
}

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
export function formatContentItemForLlm(item: ContentItem, maxBodyLen = 0): string {
  const snippet = maxBodyLen > 0 && item.body ? item.body.slice(0, maxBodyLen) : "";
  return `- id: "${item.id}" | title: "${item.title}" | source: ${item.source}${snippet ? ` | body: ${snippet}` : ""}`;
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

/** Query LLM for JSON and map results; passthrough on skip, empty batch, or failure. */
async function runLlmBatchTransform<T>(
  model: Model<Api> | null,
  items: ContentItem[],
  systemPrompt: string,
  applyResult: (result: T, items: ContentItem[]) => ContentItem[],
  options?: { maxBodyLen?: number; skip?: boolean },
): Promise<ContentItem[]> {
  if (shouldPassthroughLlmBatch(model, items) || options?.skip) return items;

  const result = await queryLlmForJson<T>(
    model!,
    systemPrompt,
    items,
    options?.maxBodyLen ?? 0,
  );
  if (result == null) return items;

  return applyResult(result, items);
}

/** 2–3 sentence summary, or null on error. */
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
  const interestList = interests.join(", ");
  const systemPrompt = `Score each item's relevance to these interests: ${interestList}. Return a JSON array of {id, score} objects where score is 0-10. Return ONLY the JSON array, no other text.`;

  return runLlmBatchTransform(
    model,
    items,
    systemPrompt,
    (scores, sourceItems) => {
      const scoreMap = new Map(scores.map(({ id, score }) => [id, score]));
      return [...sourceItems].sort((a, b) => {
        const sa = scoreMap.get(a.id) ?? -1;
        const sb = scoreMap.get(b.id) ?? -1;
        return sb - sa;
      });
    },
    { skip: interests.length === 0 },
  );
}
