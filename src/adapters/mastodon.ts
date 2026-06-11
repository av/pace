import {
  formatAtHandle,
  formatBoosts,
  formatFavorites,
  formatMedia,
  formatReplies,
} from "./engagement";
import { joinTitle, truncateText } from "./title";

import { warnInvalidInput } from "./empty-config";
import {
  fetchJson,
  HN_ITEM_FETCH_TIMEOUT_MS,
  jsonArrayOrEmpty,
  jsonObjectOrNull,
  tryOptionalFetch,
} from "./fetch";
import { decodeNumericFeedTitle, stripHtml } from "./html";
import {
  clampAdapterLimit,
  compareIsoTimestamp,
  normalizeNonNegativeNumber,
  normalizeParamBoolean,
  normalizeParamString,
  normalizeParamStringList,
} from "../utils";
import { mapToContentItems } from "./content-item";
import { aggregateSequentialFeeds } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

interface MastodonStatus {
  id: string;
  uri: string;
  url: string | null;
  content: string;
  created_at: string;
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  account: {
    id: string;
    username: string;
    acct: string;
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
  type: string;
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

type MastodonMode = "public" | "hashtag" | "account";

/** Pick timeline mode from configured accounts/hashtags (accounts take precedence). */
export function resolveMastodonMode(
  accounts: readonly string[],
  hashtags: readonly string[],
): MastodonMode {
  if (accounts.length > 0) return "account";
  if (hashtags.length > 0) return "hashtag";
  return "public";
}

/** Build mastodon source label from timeline mode, instance, and hashtags. */
export function mastodonSourceLabel(
  mode: MastodonMode,
  instance: string,
  hashtags: readonly string[],
): string {
  if (mode === "hashtag") {
    const tagNames = hashtags.map((t) => t.replace(/^#/, "")).join("+");
    return `mastodon:${instance}:#${tagNames}`;
  }
  if (mode === "account") return `mastodon:${instance}:accounts`;
  return `mastodon:${instance}`;
}

function buildBody(status: MastodonStatus, instance: string): string {
  return joinTitle(
    formatBoosts(status.reblogs_count),
    formatFavorites(status.favourites_count),
    formatAtHandle(status.account.acct, instance),
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
  if (!content) return "(empty post)";
  return truncateText(content, 200, { ellipsis: "...", trim: false });
}

async function lookupAccount(
  instance: string,
  username: string,
): Promise<MastodonAccount | null> {
  const context = `account lookup ${username}@${instance}`;
  const raw = await tryOptionalFetch("mastodon", context, () =>
    fetchJson<unknown>(
      "mastodon",
      `https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`,
      context,
      { timeoutMs: HN_ITEM_FETCH_TIMEOUT_MS },
    ),
  );
  if (!raw) return null;
  return jsonObjectOrNull<MastodonAccount>("mastodon", raw, context, ["id"]);
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
  const context = `public timeline from ${instance}`;
  const json = await fetchJson<unknown>("mastodon", url, context);
  return jsonArrayOrEmpty<MastodonStatus>("mastodon", json, context);
}

async function fetchHashtagTimeline(
  instance: string,
  hashtag: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  const tag = hashtag.replace(/^#/, "");
  const url = withOnlyMedia(
    `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`,
    onlyMedia,
  );
  const context = `hashtag #${tag} from ${instance}`;
  const json = await fetchJson<unknown>("mastodon", url, context);
  return jsonArrayOrEmpty<MastodonStatus>("mastodon", json, context);
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
  const context = `account ${accountId} statuses from ${instance}`;
  const json = await fetchJson<unknown>("mastodon", url, context);
  return jsonArrayOrEmpty<MastodonStatus>("mastodon", json, context);
}

function parseAccountHandle(handle: string): { username: string; instance: string } | null {
  const cleaned = handle.startsWith("@") ? handle.slice(1) : handle;
  const parts = cleaned.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { username: parts[0], instance: parts[1] };
}

async function fetchAccountTimeline(
  handle: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  const parsed = parseAccountHandle(handle);
  if (!parsed) {
    warnInvalidInput("mastodon", "account handle", handle);
    return [];
  }
  const account = await lookupAccount(parsed.instance, parsed.username);
  if (!account) return [];
  return fetchAccountStatuses(parsed.instance, account.id, limit, onlyMedia);
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
    const onlyMedia = normalizeParamBoolean(config.params, "only_media");

    const mode = resolveMastodonMode(accounts, hashtags);
    const finalizeOptions = {
      limit,
      dedupeKey: (status: MastodonStatus) => status.id,
      minScore: minFavourites,
      scoreOf: (status: MastodonStatus) => status.favourites_count,
      sort: (a: MastodonStatus, b: MastodonStatus) =>
        compareIsoTimestamp(a.created_at, b.created_at, "desc"),
    };

    const keys =
      mode === "public" ? [instance] : mode === "hashtag" ? hashtags : accounts;
    const fetchOne =
      mode === "public"
        ? (inst: string) => fetchPublicTimeline(inst, limit, onlyMedia)
        : mode === "hashtag"
          ? (tag: string) => fetchHashtagTimeline(instance, tag, limit, onlyMedia)
          : (handle: string) => fetchAccountTimeline(handle, limit, onlyMedia);

    const limited = await aggregateSequentialFeeds(keys, fetchOne, finalizeOptions);

    return mapToContentItems(limited, mastodonSourceLabel(mode, instance, hashtags), (status) => ({
      id: `mastodon:${instance}:${status.id}`,
      title: buildTitle(status),
      url: status.url ?? status.uri,
      timestamp: new Date(status.created_at),
      body: buildBody(status, instance),
    }));
  },
};

export default adapter;
