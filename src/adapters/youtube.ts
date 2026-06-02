import { XMLParser } from "fast-xml-parser";
import {
  extractAtomLink,
  extractFeedRootTitle,
  extractXmlText,
  FEED_XML_PARSER_OPTIONS,
  normalizeXmlList,
  type AtomLinkField,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { formatBy, joinBodyParts } from "./engagement";
import { fetchText } from "./fetch";
import { sliceToLimit } from "../utils";
import { dedupeByKey } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const parser = new XMLParser(FEED_XML_PARSER_OPTIONS);

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
  const description = entry["media:group"]?.["media:description"];
  const author = entry.author?.name?.trim();
  const body = joinBodyParts(
    author ? formatBy(author) : undefined,
    description ? String(description) : undefined,
  );
  return body || undefined;
}

function parseEntry(entry: YTEntry, channelTitle: string): ContentItem {
  const videoId = entry["yt:videoId"] ?? "";
  const title = extractXmlText(entry.title) ?? "(untitled)";

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
  const parsed = parser.parse(xml) as YTAtomFeedParsed;
  const channelTitle =
    extractFeedRootTitle(undefined, parsed.feed?.title) ?? "YouTube";
  const entries = normalizeXmlList(parsed.feed?.entry);
  return sliceToLimit(entries, limit).map((entry) => parseEntry(entry, channelTitle));
}

const adapter: Adapter = {
  name: "youtube",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const channels = (config.params?.channels as string[]) ?? [];
    const playlists = (config.params?.playlists as string[]) ?? [];
    const limit = Math.min((config.params?.limit as number) ?? 15, 50);

    if (channels.length === 0 && playlists.length === 0) return [];

    const results = await Promise.all([
      ...channels.map((ch) => fetchYoutubeFeed("channel", ch, limit)),
      ...playlists.map((pl) => fetchYoutubeFeed("playlist", pl, limit)),
    ]);
    return dedupeByKey(results.flat(), (item) => item.id);
  },
};

export default adapter;
