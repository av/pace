import { XMLParser } from "fast-xml-parser";
import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedRootTitle,
  FEED_XML_PARSER_OPTIONS,
  normalizeXmlList,
  type AtomLinkField,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { formatBy, joinBodyParts } from "./engagement";
import { fetchText } from "./fetch";
import {
  decodeHtmlEntities,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";
import {
  normalizePositiveInteger,
  normalizeStringList,
  sliceToLimit,
} from "../utils";
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
  const rawDescription = entry["media:group"]?.["media:description"];
  const description = rawDescription
    ? stripHtml(String(rawDescription), FEED_BODY_STRIP_OPTIONS)
    : undefined;
  const author = entry.author?.name?.trim();
  const body = joinBodyParts(
    author ? formatBy(author) : undefined,
    description || undefined,
  );
  return body || undefined;
}

function parseEntry(entry: YTEntry, channelTitle: string): ContentItem {
  const videoId = entry["yt:videoId"] ?? "";
  const title = decodeHtmlEntities(extractFeedEntryTitle(entry.title), {
    numeric: true,
  });

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
  const channelTitle = decodeHtmlEntities(
    extractFeedRootTitle(undefined, parsed.feed?.title) ?? "YouTube",
    { numeric: true },
  );
  const entries = normalizeXmlList(parsed.feed?.entry);
  return sliceToLimit(entries, limit).map((entry) => parseEntry(entry, channelTitle));
}

const adapter: Adapter = {
  name: "youtube",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const channels = normalizeStringList(
      (config.params?.channels as string[]) ?? [],
    );
    const playlists = normalizeStringList(
      (config.params?.playlists as string[]) ?? [],
    );
    const limit = Math.min(
      normalizePositiveInteger(config.params?.limit, 15),
      50,
    );

    if (channels.length === 0 && playlists.length === 0) {
      console.warn("youtube: no channels or playlists configured");
      return [];
    }

    const results = await Promise.all([
      ...channels.map((ch) => fetchYoutubeFeed("channel", ch, limit)),
      ...playlists.map((pl) => fetchYoutubeFeed("playlist", pl, limit)),
    ]);
    return dedupeByKey(results.flat(), (item) => item.id);
  },
};

export default adapter;
