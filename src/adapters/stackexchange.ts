import type { Adapter, AdapterConfig, ContentItem } from "./types";

const SE_API = "https://api.stackexchange.com/2.3";

type SortType = "activity" | "votes" | "creation" | "hot" | "week" | "month";

const VALID_SORTS = new Set<SortType>([
  "activity",
  "votes",
  "creation",
  "hot",
  "week",
  "month",
]);

interface SEQuestion {
  question_id: number;
  title: string;
  link: string;
  score: number;
  answer_count: number;
  view_count: number;
  tags: string[];
  owner: { display_name: string };
  creation_date: number;
  is_answered: boolean;
  accepted_answer_id?: number;
}

interface SEResponse {
  items: SEQuestion[];
  has_more: boolean;
  quota_remaining: number;
}

function formatViewCount(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}m`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function buildBody(question: SEQuestion): string {
  const parts: string[] = [];

  parts.push(`Score: ${question.score}`);

  const answerStr = question.accepted_answer_id
    ? `${question.answer_count} answers (accepted)`
    : `${question.answer_count} answers`;
  parts.push(answerStr);

  parts.push(`${formatViewCount(question.view_count)} views`);

  if (question.tags.length > 0) {
    parts.push(`tags: ${question.tags.join(", ")}`);
  }

  if (question.owner?.display_name) {
    parts.push(`by ${question.owner.display_name}`);
  }

  return parts.join(" | ");
}

/**
 * Warn with any args (supports console.warn(msg) or console.warn(msg, err))
 * and return empty list. Centralizes the repeated warn + return [] pattern
 * used for recoverable fetch errors in fetchQuestions (!ok and catch paths).
 */
function warnAndReturnEmpty(...args: any[]): SEQuestion[] {
  console.warn(...args);
  return [];
}

async function fetchQuestions(
  site: string,
  sort: SortType,
  tags: string[],
  limit: number,
): Promise<SEQuestion[]> {
  const params = new URLSearchParams({
    order: "desc",
    sort,
    site,
    pagesize: String(limit),
    filter: "withbody",
  });

  if (tags.length > 0) {
    // SE API uses semicolons for "AND" (all tags), commas would mean "OR"
    // Use semicolons so questions must match ALL specified tags
    params.set("tagged", tags.join(";"));
  }

  const url = `${SE_API}/questions?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: {
        "Accept-Encoding": "gzip",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return warnAndReturnEmpty(
        `stackexchange: failed to fetch from ${site}: ${res.status} ${res.statusText}`,
      );
    }

    const json: SEResponse = await res.json();

    if (json.quota_remaining !== undefined && json.quota_remaining < 10) {
      console.warn(
        `stackexchange: API quota low (${json.quota_remaining} remaining)`,
      );
    }

    return json.items ?? [];
  } catch (err) {
    return warnAndReturnEmpty(`stackexchange: error fetching from ${site}:`, err);
  }
}

const adapter: Adapter = {
  name: "stackexchange",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const site = (config.params?.site as string) ?? "stackoverflow";
    const tags = (config.params?.tags as string[]) ?? [];
    const sort = (config.params?.sort as string) ?? "hot";
    const limit = Math.min((config.params?.limit as number) ?? 20, 100);
    const minScore = (config.params?.min_score as number) ?? 0;

    // Resolve sort type
    const sortLower = sort.toLowerCase();
    const effectiveSort: SortType = VALID_SORTS.has(sortLower as SortType)
      ? (sortLower as SortType)
      : "hot";

    const questions = await fetchQuestions(site, effectiveSort, tags, limit);

    // Apply minimum score filter
    const filtered =
      minScore > 0
        ? questions.filter((q) => q.score >= minScore)
        : questions;

    // Respect limit after filtering
    const limited = filtered.slice(0, limit);

    // Build source label
    let sourceLabel: string;
    if (tags.length > 0) {
      sourceLabel = `${site}:${tags.join("+")}`;
    } else {
      sourceLabel = `${site}:${effectiveSort}`;
    }

    return limited.map((question) => ({
      id: `se:${site}:${question.question_id}`,
      title: question.title,
      url: question.link,
      source: sourceLabel,
      timestamp: new Date(question.creation_date * 1000),
      body: buildBody(question),
    }));
  },
};

export default adapter;
