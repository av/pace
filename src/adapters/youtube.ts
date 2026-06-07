import {
  extractAtomLink,
  type AtomLinkField,
  type XmlTextField,
} from "./atom";
import {
  formatBy,
} from "./engagement";
import { joinTitle } from "./title";

import { warnEmptyConfig } from "./empty-config";
import {
  FEED_ENTRY_DATE_ATOM_ORDER,
  projectFeedEntryToContentItem,
  resolveDecodedFeedRootTitle,
} from "./feed-entry";
import { fetchAtomFeed } from "./fetch";
import { FEED_BODY_STRIP_OPTIONS, stripHtml } from "./html";
import {
  clampAdapterLimit,
  normalizeParamStringList,
  sliceToLimit,
} from "../utils";
import { compareItemTimestampDesc, fetchAllParallel, finalizeFetchedItems } from "./merge";
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

function parseEntry(entry: YTEntry, channelTitle: string): ContentItem {
  return projectFeedEntryToContentItem(
    "youtube",
    entry,
    ({ title }) => {
      const videoId = entry["yt:videoId"] ?? "";
      const link = videoId
        ? `https://www.youtube.com/watch?v=${videoId}`
        : extractAtomLink(entry.link);
      return {
        idSuffix: videoId || title,
        url: link,
        source: `youtube:${channelTitle}`,
        body: buildBody(entry),
      };
    },
    FEED_ENTRY_DATE_ATOM_ORDER,
  );
}

async function fetchYoutubeFeed(
  kind: "channel" | "playlist",
  id: string,
  limit: number,
): Promise<ContentItem[]> {
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
  return sliceToLimit(entries, limit).map((entry) => parseEntry(entry, channelTitle));
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
    const allItems = await fetchAllParallel(sources, ([kind, id]) =>
      fetchYoutubeFeed(kind, id, limit),
    );
    return finalizeFetchedItems(allItems, {
      limit: limit * sources.length,
      dedupeKey: (item) => item.id,
      sort: compareItemTimestampDesc,
    });
  },
};

export default adapter;
