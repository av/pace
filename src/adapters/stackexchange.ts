import {
  formatAnswers,
  formatBy,
  formatScore,
  formatTags,
  formatViews,
} from "./engagement";
import { joinTitle } from "./title";

import { parseUnixEpochSeconds } from "./dates";
import { warnAdapter } from "./empty-config";
import { arrayFieldOrEmpty, fetchJson, jsonObjectOrNull } from "./fetch";
import { decodeNumericFeedTitle } from "./html";
import {
  clampAdapterLimit,
  normalizeNonNegativeNumber,
  normalizeParamString,
  normalizeParamStringList,
  createAliasedResolver,
} from "../utils";
import { mapToContentItems } from "./content-item";
import { aggregateSequentialFeeds } from "./merge";
import { type Adapter, type AdapterConfig, type ContentItem } from "./types";

const SE_API = "https://api.stackexchange.com/2.3";

type SortType = "activity" | "votes" | "creation" | "hot" | "week" | "month";

/** Build Stack Exchange source label from site, tags, and effective sort. */
export function stackExchangeSourceLabel(
  site: string,
  tags: readonly string[],
  effectiveSort: string,
): string {
  if (tags.length > 0) return `${site}:${tags.join("+")}`;
  return `${site}:${effectiveSort}`;
}

/** Map configured sort string (canonical name or alias) to Stack Exchange API sort. Unknown → hot. */
export const resolveStackExchangeSort = createAliasedResolver<SortType>({
  types: ["activity", "votes", "creation", "hot", "week", "month"],
  aliases: {
    active: "activity",
    new: "creation",
    newest: "creation",
    recent: "creation",
    score: "votes",
    popular: "votes",
    trending: "hot",
    weekly: "week",
    monthly: "month",
  },
  fallback: "hot",
});

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

  const context = `from ${site}`;
  const raw = await fetchJson<unknown>("stackexchange", url, context, {
    headers: {
      "Accept-Encoding": "gzip",
    },
  });
  const json = jsonObjectOrNull<SEResponse>("stackexchange", raw, context, ["items"]);
  if (json == null) return [];

  if (json.quota_remaining !== undefined && json.quota_remaining < 10) {
    warnAdapter("stackexchange", `API quota low (${json.quota_remaining} remaining)`);
  }

  return arrayFieldOrEmpty<SEQuestion>("stackexchange", json, "items", context);
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

    const isMultiTag = tags.length > 1;

    const finalizeOptions = {
      limit,
      dedupeKey: isMultiTag ? (q: SEQuestion) => q.question_id : undefined,
      minScore,
      scoreOf: (q: SEQuestion) => q.score,
    };

    const keys = isMultiTag ? tags : [site];
    const fetchOne = (key: string) =>
      isMultiTag
        ? fetchQuestions(site, effectiveSort, [key], limit)
        : fetchQuestions(site, effectiveSort, tags, limit);

    const limited = await aggregateSequentialFeeds(keys, fetchOne, finalizeOptions);

    return mapToContentItems(
      limited,
      stackExchangeSourceLabel(site, tags, effectiveSort),
      (question) => ({
      id: `se:${site}:${question.question_id}`,
      title: decodeNumericFeedTitle(question.title),
      url: question.link,
      timestamp: parseUnixEpochSeconds(question.creation_date),
      body: buildBody(question),
    }),
    );
  },
};

export default adapter;
