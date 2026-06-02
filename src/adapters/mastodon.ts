import { fetchWithTimeout } from "./fetch";
import { stripHtml } from "./html";
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

function resolveAcct(account: MastodonStatus["account"], instance: string): string {
  // If acct contains @, it's already fully qualified (remote user)
  if (account.acct.includes("@")) {
    return `@${account.acct}`;
  }
  // Local user: append the instance
  return `@${account.acct}@${instance}`;
}

function buildBody(status: MastodonStatus, instance: string): string {
  const parts: string[] = [];

  parts.push(`${status.reblogs_count} boosts`);
  parts.push(`${status.favourites_count} favorites`);

  const fullAcct = resolveAcct(status.account, instance);
  parts.push(fullAcct);

  if (status.replies_count > 0) {
    parts.push(`${status.replies_count} replies`);
  }

  if (status.media_attachments.length > 0) {
    const mediaUrls = status.media_attachments.map((m) => m.url).join(" ");
    parts.push(`media: ${mediaUrls}`);
  }

  return parts.join(" | ");
}

function buildTitle(status: MastodonStatus): string {
  const content = stripHtml(status.content, { blockBreaks: true });
  if (!content && status.spoiler_text) {
    return status.spoiler_text;
  }
  // Truncate long posts for the title
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
    const res = await fetchWithTimeout(
      `https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`,
      { timeoutMs: 10_000 },
    );
    if (!res.ok) {
      console.warn(
        `mastodon: account lookup ${username}@${instance}: HTTP ${res.status}`,
      );
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(
      `mastodon: account lookup ${username}@${instance}: ${errorMessage(err)}`,
    );
    return null;
  }
}

async function fetchMastodonStatuses(
  url: string,
  context: string,
): Promise<MastodonStatus[]> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`mastodon: failed to fetch ${context}: ${errorMessage({ message: String(res.status) })}`);
  }
  return await res.json();
}

async function fetchPublicTimeline(
  instance: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  let url = `https://${instance}/api/v1/timelines/public?limit=${limit}`;
  if (onlyMedia) url += "&only_media=true";
  return fetchMastodonStatuses(url, `public timeline from ${instance}`);
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
  return fetchMastodonStatuses(url, `hashtag #${tag} from ${instance}`);
}

async function fetchAccountStatuses(
  instance: string,
  accountId: string,
  limit: number,
  onlyMedia: boolean,
): Promise<MastodonStatus[]> {
  let url = `https://${instance}/api/v1/accounts/${accountId}/statuses?limit=${limit}&exclude_replies=true&exclude_reblogs=true`;
  if (onlyMedia) url += "&only_media=true";
  return fetchMastodonStatuses(url, `account ${accountId} statuses from ${instance}`);
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
    const instance = (config.params?.instance as string) ?? "mastodon.social";
    const hashtags = (config.params?.hashtags as string[]) ?? [];
    const accounts = (config.params?.accounts as string[]) ?? [];
    const limit = Math.min((config.params?.limit as number) ?? 20, 40);
    const onlyMedia = (config.params?.only_media as boolean) ?? false;

    // Determine mode based on config
    // Priority: accounts > hashtags > public timeline
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
        // Fetch each hashtag timeline and merge
        for (const tag of hashtags) {
          const statuses = await fetchHashtagTimeline(instance, tag, limit, onlyMedia);
          allStatuses.push(...statuses);
        }
      } else if (mode === "account") {
        // Resolve and fetch each account
        for (const handle of accounts) {
          const parsed = parseAccountHandle(handle);
          if (!parsed) {
            console.warn(`mastodon: invalid account handle: ${handle}`);
            continue;
          }
          // Look up the account on their home instance
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

      // Deduplicate by status ID (possible overlap across hashtags)
      const seen = new Set<string>();
      allStatuses = allStatuses.filter((status) => {
        if (seen.has(status.id)) return false;
        seen.add(status.id);
        return true;
      });

      // Sort by timestamp (newest first)
      allStatuses.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );

      // Apply limit
      const limited = allStatuses.slice(0, limit);

      // Build source label
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
      throw new Error(`mastodon: error fetching from ${instance}: ${errorMessage(err)}`);
    }
  },
};

export default adapter;
