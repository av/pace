import { formatBy, formatScore, formatTags, formatViews, joinBodyParts } from "./engagement";
import { parseUnixEpochSeconds } from "./dates";
import { fetchJson } from "./fetch";
import { dedupeByKey, fetchAndConcat, sliceToLimit } from "./merge";
import { type Adapter, type AdapterConfig, type ContentItem } from "./types";

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

function buildBody(question: SEQuestion): string {
  const answerStr = question.accepted_answer_id
    ? `${question.answer_count} answers (accepted)`
    : `${question.answer_count} answers`;
  return joinBodyParts(
    formatScore(question.score),
    answerStr,
    formatViews(question.view_count),
    formatTags(question.tags),
    question.owner?.display_name ? formatBy(question.owner.display_name) : undefined,
  );
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
    params.set("tagged", tags.join(";"));
  }

  const url = `${SE_API}/questions?${params.toString()}`;

  const json = await fetchJson<SEResponse>("stackexchange", url, `from ${site}`, {
    headers: {
      "Accept-Encoding": "gzip",
    },
  });

  if (json.quota_remaining !== undefined && json.quota_remaining < 10) {
    console.warn(
      `stackexchange: API quota low (${json.quota_remaining} remaining)`,
    );
  }

  return json.items ?? [];
}

const adapter: Adapter = {
  name: "stackexchange",
  /**
   * @param config.params.tags Multiple tags are OR: one API request per tag, merged and deduped by `question_id`.
   */
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const site = (config.params?.site as string) ?? "stackoverflow";
    const tags = (config.params?.tags as string[]) ?? [];
    const sort = (config.params?.sort as string) ?? "hot";
    const limit = Math.min((config.params?.limit as number) ?? 20, 100);
    const minScore = (config.params?.min_score as number) ?? 0;

    const sortLower = sort.toLowerCase();
    const effectiveSort: SortType = VALID_SORTS.has(sortLower as SortType)
      ? (sortLower as SortType)
      : "hot";

    let questions: SEQuestion[];
    if (tags.length > 1) {
      questions = await fetchAndConcat(tags, (tag) =>
        fetchQuestions(site, effectiveSort, [tag], limit),
      );
      questions = dedupeByKey(questions, (q) => q.question_id);
    } else {
      questions = await fetchQuestions(site, effectiveSort, tags, limit);
    }

    const filtered =
      minScore > 0
        ? questions.filter((q) => q.score >= minScore)
        : questions;

    const limited = sliceToLimit(filtered, limit);

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
      timestamp: parseUnixEpochSeconds(question.creation_date),
      body: buildBody(question),
    }));
  },
};

export default adapter;
