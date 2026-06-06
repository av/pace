import {
  formatAnswers,
  formatBy,
  formatScore,
  formatTags,
  formatViews,
} from "./engagement";
import { joinTitle } from "./title";

import { parseUnixEpochSeconds } from "./dates";
import { fetchJson } from "./fetch";
import { decodeNumericFeedTitle } from "./html";
import {
  clampAdapterLimit,
  normalizeNonNegativeNumber,
  normalizeParamString,
  normalizeParamStringList,
  resolveAliasedOption,
  sliceToLimit,
} from "../utils";
import { dedupeByKey, fetchAndConcat } from "./merge";
import { type Adapter, type AdapterConfig, type ContentItem } from "./types";

const SE_API = "https://api.stackexchange.com/2.3";

type SortType = "activity" | "votes" | "creation" | "hot" | "week" | "month";

const SORT_TYPES: Record<string, SortType> = {
  activity: "activity",
  votes: "votes",
  creation: "creation",
  hot: "hot",
  week: "week",
  month: "month",
};

const SORT_ALIASES: Record<string, SortType> = {
  active: "activity",
  new: "creation",
  newest: "creation",
  recent: "creation",
  score: "votes",
  popular: "votes",
  trending: "hot",
  weekly: "week",
  monthly: "month",
};

/** Map configured sort string (canonical name or alias) to Stack Exchange API sort. Unknown → hot. */
export function resolveStackExchangeSort(sort: string): SortType {
  return resolveAliasedOption(sort, SORT_TYPES, SORT_ALIASES, "hot");
}

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
  return joinTitle(
    formatScore(question.score),
    formatAnswers(question.answer_count, !!question.accepted_answer_id),
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
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const site = normalizeParamString(config.params, "site", "stackoverflow");
    const tags = normalizeParamStringList(config.params, "tags");
    const sort = normalizeParamString(config.params, "sort", "hot");
    const limit = clampAdapterLimit(config.params?.limit, 20, 100);
    const minScore = normalizeNonNegativeNumber(config.params?.min_score);

    const effectiveSort = resolveStackExchangeSort(sort);

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
      title: decodeNumericFeedTitle(question.title),
      url: question.link,
      source: sourceLabel,
      timestamp: parseUnixEpochSeconds(question.creation_date),
      body: buildBody(question),
    }));
  },
};

export default adapter;
