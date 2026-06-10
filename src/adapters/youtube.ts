import {
  extractAtomLink,
  type AtomLinkField,
  type XmlTextField,
} from "./atom";
import {
  formatBy,
} from "./engagement";
import { mapToContentItemsPerSource, type ContentItemProjection } from "./content-item";
import { joinTitle } from "./title";

import { warnEmptyConfig } from "./empty-config";
import {
  decodeFeedEntryTitle,
  FEED_ENTRY_DATE_ATOM_ORDER,
  parseFeedEntryTimestamp,
  resolveDecodedFeedRootTitle,
} from "./feed-entry";
import { fetchAtomFeed } from "./fetch";
import { FEED_BODY_STRIP_OPTIONS, stripHtml } from "./html";
import {
  clampAdapterLimit,
  normalizeParamStringList,
  sliceToLimit,
} from "../utils";
import { aggregateParallelFeeds } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

interface YTEntry {
  "yt:videoId"?: string;
  title?: XmlTextField;
  link?: AtomLinkField;
  published?: string;
  "media:group"?: {
    "media:description"?: string;
  };
  author?: {
    name?: string;
  };
}

interface YTAtomFeedParsed {
  feed?: {
    entry?: YTEntry | YTEntry[];
    title?: XmlTextField;
  };
}

interface TaggedYTEntry {
  entry: YTEntry;
  channelTitle: string;
  timestamp: Date;
}

function youtubeDedupeKey(item: TaggedYTEntry): string {
  const videoId = item.entry["yt:videoId"] ?? "";
  const title = decodeFeedEntryTitle(item.entry.title);
  return `youtube:${videoId || title}`;
}

function buildBody(entry: YTEntry): string | undefined {
  const rawDescription = entry["media:group"]?.["media:description"];
  const description = rawDescription
    ? stripHtml(String(rawDescription), FEED_BODY_STRIP_OPTIONS)
    : undefined;
  const author = entry.author?.name?.trim();
  const body = joinTitle(
    author ? formatBy(author) : undefined,
    description || undefined,
  );
  return body || undefined;
}

function projectYoutubeEntry(item: TaggedYTEntry): ContentItemProjection {
  const entry = item.entry;
  const title = decodeFeedEntryTitle(entry.title);
  const videoId = entry["yt:videoId"] ?? "";
  const link = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : extractAtomLink(entry.link);
  return {
    id: `youtube:${videoId || title}`,
    title,
    url: link,
    timestamp: item.timestamp,
    body: buildBody(entry),
  };
}

async function fetchYoutubeFeed(
  kind: "channel" | "playlist",
  id: string,
  limit: number,
): Promise<TaggedYTEntry[]> {
  const param = kind === "channel" ? "channel_id" : "playlist_id";
  const label = kind;
  const url = `https://www.youtube.com/feeds/videos.xml?${param}=${id}`;
  const { parsed, entries } = await fetchAtomFeed<YTEntry, YTAtomFeedParsed>(
    "youtube",
    url,
    `${label} ${id}`,
  );
  const channelTitle = resolveDecodedFeedRootTitle(
    undefined,
    parsed.feed?.title,
    "YouTube",
  )!;
  return sliceToLimit(entries, limit).map((entry) => ({
    entry,
    channelTitle,
    timestamp: parseFeedEntryTimestamp(entry, FEED_ENTRY_DATE_ATOM_ORDER),
  }));
}

const adapter: Adapter = {
  name: "youtube",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const channels = normalizeParamStringList(config.params, "channels");
    const playlists = normalizeParamStringList(config.params, "playlists");
    const limit = clampAdapterLimit(config.params?.limit, 15, 50);

    if (channels.length === 0 && playlists.length === 0) {
      return warnEmptyConfig("youtube", "no channels or playlists configured");
    }

    const sources = [
      ...channels.map((ch) => ["channel", ch] as const),
      ...playlists.map((pl) => ["playlist", pl] as const),
    ];
    const tagged = await aggregateParallelFeeds(
      sources,
      ([kind, id]) => fetchYoutubeFeed(kind, id, limit),
      {
        perSourceLimit: limit,
        dedupeKey: youtubeDedupeKey,
      },
    );

    return mapToContentItemsPerSource(
      tagged,
      (item) => `youtube:${item.channelTitle}`,
      projectYoutubeEntry,
    );
  },
};

export default adapter;