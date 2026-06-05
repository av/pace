import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedRootTitle,
  parseFeedXml,
  normalizeXmlList,
  type AtomLinkField,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import {
  formatBy,
} from "./engagement";
import { joinTitle } from "./title";

import { fetchText } from "./fetch";
import {
  decodeNumericFeedTitle,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";
import {
  clampAdapterLimit,
  normalizeParamStringList,
  sliceToLimit,
} from "../utils";
import { fetchAllParallelDedupe } from "./merge";
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
  const videoId = entry["yt:videoId"] ?? "";
  const title = decodeNumericFeedTitle(extractFeedEntryTitle(entry.title));

  const link = videoId
    ? `https://www.youtube.com/watch?v=${videoId}`
    : extractAtomLink(entry.link);

  const timestamp = parseFeedDate(entry.published ?? "");

  return {
    id: `youtube:${videoId || title}`,
    title: String(title),
    url: link,
    source: `youtube:${channelTitle}`,
    timestamp,
    body: buildBody(entry),
  };
}

async function fetchYoutubeFeed(
  kind: "channel" | "playlist",
  id: string,
  limit: number,
): Promise<ContentItem[]> {
  const param = kind === "channel" ? "channel_id" : "playlist_id";
  const label = kind;
  const url = `https://www.youtube.com/feeds/videos.xml?${param}=${id}`;
  const xml = await fetchText("youtube", url, `${label} ${id}`);
  const parsed = parseFeedXml<YTAtomFeedParsed>(xml, "youtube", url);
  const channelTitle = decodeNumericFeedTitle(
    extractFeedRootTitle(undefined, parsed.feed?.title) ?? "YouTube",
  );
  const entries = normalizeXmlList(parsed.feed?.entry);
  return sliceToLimit(entries, limit).map((entry) => parseEntry(entry, channelTitle));
}

const adapter: Adapter = {
  name: "youtube",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const channels = normalizeParamStringList(config.params, "channels");
    const playlists = normalizeParamStringList(config.params, "playlists");
    const limit = clampAdapterLimit(config.params?.limit, 15, 50);

    if (channels.length === 0 && playlists.length === 0) {
      console.warn("youtube: no channels or playlists configured");
      return [];
    }

    const sources = [
      ...channels.map((ch) => ["channel", ch] as const),
      ...playlists.map((pl) => ["playlist", pl] as const),
    ];
    return fetchAllParallelDedupe(
      sources,
      ([kind, id]) => fetchYoutubeFeed(kind, id, limit),
      (item) => item.id,
    );
  },
};

export default adapter;
