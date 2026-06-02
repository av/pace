import {
  formatBoosts,
  formatFavorites,
  formatMastodonAcct,
  formatMedia,
  formatReplies,
  joinBodyParts,
} from "./engagement";
import { fetchJson, HN_ITEM_FETCH_TIMEOUT_MS } from "./fetch";
import { decodeHtmlEntities, stripHtml } from "./html";
import {
  normalizeNonNegativeNumber,
  normalizeOptionalString,
  normalizeStringList,
  sliceToLimit,
} from "../utils";
import { dedupeByKey, fetchAndConcat, sortByCreatedAtDesc } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

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

function publicTimelineContext(instance: string): string {
  return `public timeline from ${instance}`;
}

function hashtagTimelineContext(instance: string, hashtag: string): string {
  const tag = hashtag.replace(/^#/, "");
  return `hashtag #${tag} from ${instance}`;
}

function accountStatusesContext(instance: string, accountId: string): string {
  return `account ${accountId} statuses from ${instance}`;
}

/** Primary fetch context for outer-catch fallback (matches fetchJson contexts). */
function mastodonPrimaryFetchContext(
  mode: Mode,
  instance: string,
  hashtags: string[],
): string {
  if (mode === "public") return publicTimelineContext(instance);
  if (mode === "hashtag") {
    const tag = hashtags[0] ?? "";
    return tag ? hashtagTimelineContext(instance, tag) : `hashtag timeline from ${instance}`;
  }
  return `account statuses from ${instance}`;
}

function buildBody(status: MastodonStatus, instance: string): string {
  return joinBodyParts(
    formatBoosts(status.reblogs_count),
    formatFavorites(status.favourites_count),
    formatMastodonAcct(status.account.acct, instance),
    status.replies_count > 0 ? formatReplies(status.replies_count) : undefined,
    formatMedia(status.media_attachments.map((m) => m.url)),
  );
}

function decodePostTitle(text: string): string {
  return decodeHtmlEntities(text, { numeric: true });
}

function buildTitle(status: MastodonStatus): string {
  const content = decodePostTitle(
    stripHtml(status.content, { blockBreaks: true }),
  );
  if (!content && status.spoiler_text) {
    return decodePostTitle(status.spoiler_text);
  }
  if (content.length > 200) {
    return content.slice(0, 197) + "...";
  }
  return content || "(empty post)";
}

function warnLookupAccountFailed(
  username: string,
  instance: string,
  detail: unknown,
): void {
  const msg = errorMessage(detail);
  console.warn(
    msg.startsWith("mastodon:")
      ? msg
      : `mastodon: account lookup ${username}@${instance}: ${msg}`,
  );
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
    warnLookupAccountFailed(username, instance, err);
    return null;
  }
}

async function fetchPublicTimeline(
  instance: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  let url = `https://${instance}/api/v1/timelines/public?limit=${limit}`;
  if (onlyMedia) url += "&only_media=true";
  return fetchJson<MastodonStatus[]>("mastodon", url, publicTimelineContext(instance));
}

async function fetchHashtagTimeline(
  instance: string,
  hashtag: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  const tag = hashtag.replace(/^#/, ""); // strip leading # if present
  let url = `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=${limit}`;
  if (onlyMedia) url += "&only_media=true";
  return fetchJson<MastodonStatus[]>("mastodon", url, hashtagTimelineContext(instance, tag));
}

async function fetchAccountStatuses(
  instance: string,
  accountId: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  let url = `https://${instance}/api/v1/accounts/${accountId}/statuses?limit=${limit}&exclude_replies=true&exclude_reblogs=true`;
  if (onlyMedia) url += "&only_media=true";
  return fetchJson<MastodonStatus[]>(
    "mastodon",
    url,
    accountStatusesContext(instance, accountId),
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
    const instance =
      normalizeOptionalString(config.params?.instance as string | undefined) ??
      "mastodon.social";
    const hashtags = normalizeStringList(
      (config.params?.hashtags as string[]) ?? [],
    );
    const accounts = normalizeStringList(
      (config.params?.accounts as string[]) ?? [],
    );
    const limit = Math.min((config.params?.limit as number) ?? 20, 40);
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

    try {
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
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("mastodon:")) {
        throw err;
      }
      const context = mastodonPrimaryFetchContext(mode, instance, hashtags);
      throw new Error(`mastodon: error fetching ${context}: ${errorMessage(err)}`);
    }
  },
};

export default adapter;
