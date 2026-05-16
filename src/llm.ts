import { getModel, complete, type Model, type Api, type Context } from "@mariozechner/pi-ai";
import type { LlmConfig, LlmDigestConfig } from "./config";
import type { ContentItem } from "./adapters/types";

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

  // Set the API key in env if provided
  if (config.api_key) {
    const envKey = PROVIDER_ENV_KEYS[config.provider];
    if (envKey) {
      process.env[envKey] = config.api_key;
    }
  }

  // For known providers, use getModel
  try {
    const model = getModel(config.provider as any, config.model as any);
    return model as Model<Api>;
  } catch {
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

/** Extract text from a pi-ai AssistantMessage response */
function extractText(content: { type: string; text?: string }[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Summarize a single content item. Returns a 2-3 sentence summary, or null on error.
 */
export async function summarizeItem(
  model: Model<Api>,
  item: ContentItem
): Promise<string | null> {
  try {
    const userContent = item.body
      ? `Title: ${item.title}\n\n${item.body}`
      : `Title: ${item.title}`;

    const context: Context = {
      systemPrompt:
        "You are a concise summarizer. Provide a 2-3 sentence summary of the given content item. Focus on the key points and why it matters.",
      messages: [{ role: "user", content: userContent, timestamp: Date.now() }],
    };

    const response = await complete(model, context);
    const text = extractText(response.content);
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Generate a daily digest across all content items. Returns the digest text, or null on error.
 */
export async function generateDigest(
  model: Model<Api>,
  items: ContentItem[],
  config: LlmDigestConfig
): Promise<string | null> {
  if (items.length === 0) return null;

  try {
    const focusAreas = config.focus_areas?.join(", ") ?? "general topics";
    const style = config.style ?? "brief";
    const maxLength = config.max_length ?? 500;

    const systemPrompt = `Generate a daily digest summarizing the following content items. Focus on: ${focusAreas}. Style: ${style}. Max length: ~${maxLength} words.`;

    const itemList = items
      .map((item, i) => {
        const snippet = item.body ? item.body.slice(0, 200) : "";
        return `${i + 1}. [${item.source}] ${item.title}${snippet ? `\n   ${snippet}` : ""}`;
      })
      .join("\n");

    const context: Context = {
      systemPrompt,
      messages: [
        { role: "user", content: itemList, timestamp: Date.now() },
      ],
    };

    const response = await complete(model, context);
    const text = extractText(response.content);
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Lens/rank items by relevance to user interests via LLM scoring.
 * Returns items sorted by relevance score (descending).
 * On error, returns items unchanged (graceful degradation).
 */
export async function lensItems(
  model: Model<Api>,
  items: ContentItem[],
  interests: string[]
): Promise<ContentItem[]> {
  if (items.length === 0 || interests.length === 0) return items;

  try {
    const interestList = interests.join(", ");
    const systemPrompt = `Score each item's relevance to these interests: ${interestList}. Return a JSON array of {id, score} objects where score is 0-10. Return ONLY the JSON array, no other text.`;

    const itemList = items
      .map((item) => `- id: "${item.id}" | title: "${item.title}" | source: ${item.source}`)
      .join("\n");

    const context: Context = {
      systemPrompt,
      messages: [
        { role: "user", content: itemList, timestamp: Date.now() },
      ],
    };

    const response = await complete(model, context);
    const text = extractText(response.content);

    // Parse JSON from the response — handle markdown code fences
    const jsonStr = text.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
    const scores: { id: string; score: number }[] = JSON.parse(jsonStr);

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
  } catch {
    // Graceful degradation — return items unchanged
    return items;
  }
}
