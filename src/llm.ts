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
  // Applies even when the model config is incomplete: the timeout is
  // process-wide state, and re-creating a model must never leave a stale
  // value from a previous config behind.
  configuredTimeoutMs =
    config.timeout_seconds !== undefined
      ? config.timeout_seconds * 1000
      : LLM_COMPLETE_TIMEOUT_MS;

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

/**
 * Upper bound for a single LLM completion. Batch transforms run inside the
 * scheduler's per-panel refresh slot; without a timeout a hung provider
 * (e.g. a stalled local Ollama) would block that panel's refreshes forever.
 * Generous because batch summarize/merge calls over dozens of items are slow.
 */
export const LLM_COMPLETE_TIMEOUT_MS = 120_000;

/**
 * Effective completion timeout: `llm.timeout_seconds` from config (set by
 * `createModel`) or the 120s default. Module-level because batch transform
 * helpers call `safeComplete` without threading config through.
 */
let configuredTimeoutMs = LLM_COMPLETE_TIMEOUT_MS;

/** Current effective LLM completion timeout in ms (for tests/diagnostics). */
export function llmCompleteTimeoutMs(): number {
  return configuredTimeoutMs;
}

/** True for the abort error produced by AbortSignal.timeout(). */
function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" ||
      (err.name === "AbortError" && /time/i.test(err.message)))
  );
}

/** complete() + text blocks; null on failure or timeout. */
export async function safeComplete(
  model: Model<Api>,
  context: Context,
  timeoutMs?: number,
): Promise<string | null> {
  const effectiveTimeoutMs = timeoutMs ?? configuredTimeoutMs;
  try {
    const response = await complete(model, context, {
      signal: AbortSignal.timeout(effectiveTimeoutMs),
    });
    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text || null;
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      warnLlm(`complete timed out after ${effectiveTimeoutMs}ms`);
    } else {
      warnLlm("complete failed", err);
    }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Warn about a malformed (valid JSON, wrong shape) LLM response and signal passthrough. */
function warnMalformedLlmResponse(context: string): null {
  warnLlm(`malformed response shape (${context}), items passed through unchanged`);
  return null;
}

/**
 * Query LLM for JSON, validate the response shape, and map results;
 * passthrough on skip, empty batch, or any failure (network, parse,
 * malformed shape, or an applyResult throw).
 */
async function runLlmBatchTransform<T>(
  model: Model<Api> | null,
  items: ContentItem[],
  systemPrompt: string,
  validateResult: (result: unknown) => T | null,
  applyResult: (result: T, items: ContentItem[]) => ContentItem[],
  options?: { maxBodyLen?: number; skip?: boolean; fetchedContent?: Map<string, string> },
): Promise<ContentItem[]> {
  if (shouldPassthroughLlmBatch(model, items) || options?.skip) return items;

  const raw = await queryLlmForJson<unknown>(
    model!,
    systemPrompt,
    items,
    options?.maxBodyLen ?? 0,
    options?.fetchedContent,
  );
  if (raw == null) return items;

  const result = validateResult(raw);
  if (result == null) return items;

  try {
    return applyResult(result, items);
  } catch (err: unknown) {
    warnLlm("applying response failed, items passed through unchanged", err);
    return items;
  }
}

type SummaryEntry = { id: string; summary: string };

/** Accepts an array; keeps only well-formed {id, summary} entries. Null if not an array. */
function validateSummaryEntries(result: unknown): SummaryEntry[] | null {
  if (!Array.isArray(result)) return warnMalformedLlmResponse("summaries: expected JSON array");
  return result.filter(
    (entry): entry is SummaryEntry =>
      isRecord(entry) && typeof entry.id === "string" && typeof entry.summary === "string",
  );
}

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

  return runLlmBatchTransform(model, items, systemPrompt, validateSummaryEntries, applySummaryEntries, { maxBodyLen: 2000, fetchedContent });
}

/** 2-3 sentence summary, or null on error. */
export async function summarizeItem(
  model: Model<Api> | null,
  item: ContentItem
): Promise<string | null> {
  if (!model) return null;
  const [result] = await summarizeItems(model, [item]);
  return result.summary ?? null;
}

type MergeGroup = { merged_ids: string[]; title: string; summary: string | null };

/**
 * Merge output is exhaustive (items absent from every group are dropped), so a
 * single malformed group means the whole response is unusable: passthrough.
 */
function validateMergeGroups(result: unknown): MergeGroup[] | null {
  if (!Array.isArray(result)) return warnMalformedLlmResponse("merge: expected JSON array");
  const valid = result.every(
    (group) =>
      isRecord(group) &&
      Array.isArray(group.merged_ids) &&
      group.merged_ids.length > 0 &&
      group.merged_ids.every((id: unknown) => typeof id === "string") &&
      typeof group.title === "string",
  );
  if (!valid) return warnMalformedLlmResponse("merge: invalid group entry");
  return (result as MergeGroup[]).map((group) => ({
    ...group,
    summary: typeof group.summary === "string" ? group.summary : null,
  }));
}

function applyMergeGroups(groups: MergeGroup[], items: ContentItem[]): ContentItem[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const result: ContentItem[] = [];
  const claimedIds = new Set<string>();
  let unknownIdCount = 0;
  let duplicateIdCount = 0;

  for (const group of groups) {
    // LLMs sometimes hallucinate ids that were never in the batch; drop them
    // so we never fabricate ghost items (url "", source "merged") from thin air.
    // Ids repeated within a group or across groups are kept only on first use,
    // so one input item never yields multiple output items.
    const knownIds: string[] = [];
    for (const id of group.merged_ids) {
      if (!itemMap.has(id)) {
        unknownIdCount++;
      } else if (claimedIds.has(id)) {
        duplicateIdCount++;
      } else {
        claimedIds.add(id);
        knownIds.push(id);
      }
    }
    if (knownIds.length === 0) continue;

    if (knownIds.length === 1 && !group.summary) {
      result.push(itemMap.get(knownIds[0])!);
      continue;
    }

    const firstItem = itemMap.get(knownIds[0])!;
    result.push({
      id: knownIds.join("+"),
      title: group.title,
      url: firstItem.url,
      source: firstItem.source,
      timestamp: firstItem.timestamp,
      body: group.summary ?? undefined,
    });
  }

  if (unknownIdCount > 0) {
    warnLlm(`merge response referenced ${unknownIdCount} unknown item id(s), ignored`);
  }
  if (duplicateIdCount > 0) {
    warnLlm(`merge response repeated ${duplicateIdCount} item id(s), kept first occurrence only`);
  }

  const mentioned = new Set(groups.flatMap((group) => group.merged_ids));
  const droppedCount = items.filter((item) => !mentioned.has(item.id)).length;
  if (droppedCount > 0) {
    warnLlm(`merge response omitted ${droppedCount} item(s), dropped from output`);
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

  return runLlmBatchTransform(model, items, systemPrompt, validateMergeGroups, applyMergeGroups, { maxBodyLen: 300 });
}

/** LLM filter by criteria string; unchanged on failure. */
export async function filterItemsByLlm(
  model: Model<Api> | null,
  items: ContentItem[],
  criteria: string
): Promise<ContentItem[]> {
  const systemPrompt = `Given the criteria: "${criteria}", decide which items to keep. Return a JSON array of item IDs that match. Return ONLY the JSON array of strings.`;

  return runLlmBatchTransform<string[]>(
    model,
    items,
    systemPrompt,
    (result) => {
      if (!Array.isArray(result)) return warnMalformedLlmResponse("filter: expected JSON array");
      return result.filter((id): id is string => typeof id === "string");
    },
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
    (result) => {
      if (!Array.isArray(result)) return warnMalformedLlmResponse("scores: expected JSON array");
      return result.filter(
        (entry): entry is ScoreEntry =>
          isRecord(entry) && typeof entry.id === "string" &&
          typeof entry.score === "number" && Number.isFinite(entry.score),
      );
    },
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
