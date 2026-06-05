import {
  formatBoosts,
  formatFavorites,
  formatMastodonAcct,
  formatMedia,
  formatReplies,
} from "./engagement";
import { joinTitle } from "./title";

import { fetchJson, HN_ITEM_FETCH_TIMEOUT_MS, warnOptionalFetchFailure } from "./fetch";
import { decodeNumericFeedTitle, stripHtml } from "./html";
import {
  clampAdapterLimit,
  normalizeNonNegativeNumber,
  normalizeParamString,
  normalizeParamStringList,
  sliceToLimit,
} from "../utils";
import { dedupeByKey, fetchAndConcat, sortByCreatedAtDesc } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

interface MastodonStatus {
  id: string;
  uri: string;
  url: string | null;
  content: string; // HTML
  created_at: string;
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  account: {
    id: string;
    username: string;
    acct: string; // local users: "username", remote: "user@instance"
    display_name: string;
    url: string;
  };
  media_attachments: MastodonMedia[];
  tags: MastodonTag[];
  spoiler_text: string;
  reblog: MastodonStatus | null;
}

interface MastodonMedia {
  id: string;
  type: string; // "image", "video", "gifv", "audio"
  url: string;
  preview_url: string;
  description: string | null;
}

interface MastodonTag {
  name: string;
  url: string;
}

interface MastodonAccount {
  id: string;
  username: string;
  acct: string;
  display_name: string;
  url: string;
}

type Mode = "public" | "hashtag" | "account";

function buildBody(status: MastodonStatus, instance: string): string {
  return joinTitle(
    formatBoosts(status.reblogs_count),
    formatFavorites(status.favourites_count),
    formatMastodonAcct(status.account.acct, instance),
    status.replies_count > 0 ? formatReplies(status.replies_count) : undefined,
    formatMedia(status.media_attachments.map((m) => m.url)),
  );
}

function buildTitle(status: MastodonStatus): string {
  const content = decodeNumericFeedTitle(
    stripHtml(status.content, { blockBreaks: true }),
  );
  if (!content && status.spoiler_text) {
    return decodeNumericFeedTitle(status.spoiler_text);
  }
  if (content.length > 200) {
    return content.slice(0, 197) + "...";
  }
  return content || "(empty post)";
}

async function lookupAccount(
  instance: string,
  username: string,
): Promise<MastodonAccount | null> {
  try {
    return await fetchJson<MastodonAccount>(
      "mastodon",
      `https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`,
      `account lookup ${username}@${instance}`,
      { timeoutMs: HN_ITEM_FETCH_TIMEOUT_MS },
    );
  } catch (err) {
    warnOptionalFetchFailure(
      "mastodon",
      err,
      `account lookup ${username}@${instance}`,
    );
    return null;
  }
}

function withOnlyMedia(url: string, onlyMedia: boolean): string {
  return onlyMedia ? `${url}&only_media=true` : url;
}

async function fetchPublicTimeline(
  instance: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  const url = withOnlyMedia(
    `https://${instance}/api/v1/timelines/public?limit=${limit}`,
    onlyMedia,
  );
  return fetchJson<MastodonStatus[]>(
    "mastodon",
    url,
    `public timeline from ${instance}`,
  );
}

async function fetchHashtagTimeline(
  instance: string,
  hashtag: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  const tag = hashtag.replace(/^#/, ""); // strip leading # if present
  const url = withOnlyMedia(
    `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`,
    onlyMedia,
  );
  return fetchJson<MastodonStatus[]>(
    "mastodon",
    url,
    `hashtag #${tag} from ${instance}`,
  );
}

async function fetchAccountStatuses(
  instance: string,
  accountId: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  const url = withOnlyMedia(
    `https://${instance}/api/v1/accounts/${accountId}/statuses?limit=${limit}&exclude_replies=true&exclude_reblogs=true`,
    onlyMedia,
  );
  return fetchJson<MastodonStatus[]>(
    "mastodon",
    url,
    `account ${accountId} statuses from ${instance}`,
  );
}

function parseAccountHandle(handle: string): { username: string; instance: string } | null {
  // Accepts: @user@instance, user@instance
  const cleaned = handle.startsWith("@") ? handle.slice(1) : handle;
  const parts = cleaned.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { username: parts[0], instance: parts[1] };
}

const adapter: Adapter = {
  name: "mastodon",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const instance = normalizeParamString(
      config.params,
      "instance",
      "mastodon.social",
    );
    const hashtags = normalizeParamStringList(config.params, "hashtags");
    const accounts = normalizeParamStringList(config.params, "accounts");
    const limit = clampAdapterLimit(config.params?.limit, 20, 40);
    const minFavourites = normalizeNonNegativeNumber(config.params?.min_favourites);
    const onlyMedia = (config.params?.only_media as boolean) ?? false;

    let mode: Mode;
    if (accounts.length > 0) {
      mode = "account";
    } else if (hashtags.length > 0) {
      mode = "hashtag";
    } else {
      mode = "public";
    }

    let allStatuses: MastodonStatus[] = [];

    if (mode === "public") {
      allStatuses = await fetchPublicTimeline(instance, limit, onlyMedia);
    } else if (mode === "hashtag") {
      allStatuses = await fetchAndConcat(hashtags, (tag) =>
        fetchHashtagTimeline(instance, tag, limit, onlyMedia),
      );
    } else if (mode === "account") {
      for (const handle of accounts) {
        const parsed = parseAccountHandle(handle);
        if (!parsed) {
          console.warn(`mastodon: invalid account handle: ${handle}`);
          continue;
        }
        const account = await lookupAccount(parsed.instance, parsed.username);
        if (!account) continue;
        const statuses = await fetchAccountStatuses(
          parsed.instance,
          account.id,
          limit,
          onlyMedia,
        );
        allStatuses.push(...statuses);
      }
    }

    allStatuses = dedupeByKey(allStatuses, (status) => status.id);

    if (minFavourites > 0) {
      allStatuses = allStatuses.filter(
        (status) => status.favourites_count >= minFavourites,
      );
    }

    sortByCreatedAtDesc(allStatuses);

    const limited = sliceToLimit(allStatuses, limit);

    let sourceLabel: string;
    if (mode === "hashtag") {
      const tagNames = hashtags.map((t) => t.replace(/^#/, "")).join("+");
      sourceLabel = `mastodon:${instance}:#${tagNames}`;
    } else if (mode === "account") {
      sourceLabel = `mastodon:${instance}:accounts`;
    } else {
      sourceLabel = `mastodon:${instance}`;
    }

    return limited.map((status) => ({
      id: `mastodon:${instance}:${status.id}`,
      title: buildTitle(status),
      url: status.url ?? status.uri,
      source: sourceLabel,
      timestamp: new Date(status.created_at),
      body: buildBody(status, instance),
    }));
  },
};

export default adapter;
