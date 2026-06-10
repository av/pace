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
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  createAliasedResolver,
} from "../utils";
import { mapToContentItems } from "./content-item";
import { finalizeFetchedItems, fetchAndConcat } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

type SortType = "Hot" | "New" | "Top" | "Active" | "MostComments";

/** Build lemmy source label: single community uses c/name, multiple uses instance only. */
export function lemmySourceLabel(
  instance: string,
  communities: readonly string[],
): string {
  return communities.length === 1
    ? `lemmy:${instance}:c/${communities[0]}`
    : `lemmy:${instance}`;
}

/** Map configured sort string (canonical name or alias) to Lemmy API sort. Unknown → Hot. */
export const resolveLemmySort = createAliasedResolver<SortType>({
  types: {
    hot: "Hot",
    new: "New",
    top: "Top",
    active: "Active",
    mostcomments: "MostComments",
  },
  aliases: { most_comments: "MostComments", comments: "MostComments" },
  fallback: "Hot",
});

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
    const instance = normalizeParamString(config.params, "instance", "lemmy.ml");
    const communities = normalizeParamStringList(config.params, "communities");
    const sort = resolveLemmySort(normalizeParamString(config.params, "sort", "hot"));
    const limit = clampAdapterLimit(config.params?.limit, 25, 50);
    const minScore = normalizeNonNegativeNumber(config.params?.min_score);

    const allPosts =
      communities.length === 0
        ? await fetchLemmyPosts(
            instance,
            { sort, limit: String(limit) },
            `${instance} frontpage`,
          )
        : await fetchAndConcat(communities, (community) =>
            fetchLemmyPosts(
              instance,
              { community_name: community, sort, limit: String(limit) },
              `c/${community}@${instance}`,
            ),
          );

    const limited = finalizeFetchedItems(allPosts, {
      limit,
      dedupeKey: (view) => view.post.id,
      minScore,
      scoreOf: (view) => view.counts.score,
      sort: (a, b) => b.counts.score - a.counts.score,
    });

    return mapToContentItems(
      limited,
      lemmySourceLabel(instance, communities),
      (view) => ({
      id: `lemmy:${instance}:${view.post.id}`,
      title: decodeNumericFeedTitleOptional(view.post.name),
      url: view.post.url ?? view.post.ap_id,
      timestamp: new Date(view.post.published),
      body: buildBody(view),
    }),
    );
  },
};

export default adapter;
