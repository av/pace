import {
  formatBy,
  formatComments,
  formatCommunity,
  formatDiscuss,
  formatPoints,
} from "./engagement";
import { joinTitle } from "./title";

import { fetchJson } from "./fetch";
import { decodeNumericFeedTitleOptional } from "./html";
import {
  normalizeNonNegativeNumber,
  normalizeOptionalString,
  clampAdapterLimit,
  normalizeStringList,
  sliceToLimit,
} from "../utils";
import { dedupeByKey } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

type SortType = "Hot" | "New" | "Top" | "Active" | "MostComments";

const VALID_SORTS = new Set<SortType>(["Hot", "New", "Top", "Active", "MostComments"]);

interface LemmyPostView {
  post: {
    id: number;
    name: string;
    url?: string;
    body?: string;
    ap_id: string;
    published: string;
  };
  creator: {
    name: string;
    actor_id: string;
  };
  community: {
    name: string;
    title: string;
    actor_id: string;
  };
  counts: {
    score: number;
    upvotes: number;
    downvotes: number;
    comments: number;
  };
}

interface LemmyPostListResponse {
  posts: LemmyPostView[];
}

function buildBody(view: LemmyPostView): string {
  return joinTitle(
    formatPoints(view.counts.score),
    formatBy(view.creator.name),
    formatComments(view.counts.comments),
    formatCommunity(view.community.name),
    view.post.url && !view.post.url.includes(view.post.ap_id)
      ? formatDiscuss(view.post.ap_id)
      : undefined,
  );
}

function resolveSort(input: string | undefined): SortType {
  if (!input) return "Hot";
  const capitalized = input.charAt(0).toUpperCase() + input.slice(1).toLowerCase();
  if (VALID_SORTS.has(capitalized as SortType)) return capitalized as SortType;

  const aliases: Record<string, SortType> = {
    hot: "Hot",
    new: "New",
    top: "Top",
    active: "Active",
    mostcomments: "MostComments",
    most_comments: "MostComments",
    comments: "MostComments",
  };
  return aliases[input.toLowerCase()] ?? "Hot";
}

async function fetchLemmyPosts(
  instance: string,
  params: Record<string, string>,
  context: string,
): Promise<LemmyPostView[]> {
  const query = new URLSearchParams(params);
  const url = `https://${instance}/api/v3/post/list?${query.toString()}`;

  const json = await fetchJson<LemmyPostListResponse>("lemmy", url, context, {
    accept: "application/json",
  });
  return json.posts ?? [];
}

const adapter: Adapter = {
  name: "lemmy",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const instance =
      normalizeOptionalString(config.params?.instance as string | undefined) ??
      "lemmy.ml";
    const communities = normalizeStringList(
      (config.params?.communities as string[]) ?? [],
    );
    const sort = resolveSort(config.params?.sort as string);
    const limit = clampAdapterLimit(config.params?.limit, 25, 50);
    const minScore = normalizeNonNegativeNumber(config.params?.min_score);

    const allPosts: LemmyPostView[] = [];

    if (communities.length === 0) {
      const posts = await fetchLemmyPosts(
        instance,
        { sort, limit: String(limit) },
        `${instance} frontpage`,
      );
      allPosts.push(...posts);
    } else {
      for (const community of communities) {
        const posts = await fetchLemmyPosts(
          instance,
          { community_name: community, sort, limit: String(limit) },
          `c/${community}@${instance}`,
        );
        allPosts.push(...posts);
      }
    }

    let deduped = dedupeByKey(allPosts, (view) => view.post.id);

    if (minScore > 0) {
      deduped = deduped.filter((view) => view.counts.score >= minScore);
    }

    deduped.sort((a, b) => b.counts.score - a.counts.score);

    const limited = sliceToLimit(deduped, limit);

    const sourceLabel =
      communities.length === 1
        ? `lemmy:${instance}:c/${communities[0]}`
        : `lemmy:${instance}`;

    return limited.map((view) => ({
      id: `lemmy:${instance}:${view.post.id}`,
      title: decodeNumericFeedTitleOptional(view.post.name),
      url: view.post.url ?? view.post.ap_id,
      source: sourceLabel,
      timestamp: new Date(view.post.published),
      body: buildBody(view),
    }));
  },
};

export default adapter;
