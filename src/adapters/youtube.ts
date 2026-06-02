import { XMLParser } from "fast-xml-parser";
import { extractAtomLink } from "./atom";
import { parseFeedDate } from "./dates";
import { formatBy, joinBodyParts } from "./engagement";
import { fetchText } from "./fetch";
import { dedupeByKey, sliceToLimit } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

interface YTEntry {
  "yt:videoId"?: string;
  title?: string | { "#text": string };
  link?: { "@_href"?: string } | Array<{ "@_href"?: string; "@_rel"?: string }>;
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
    title?: string | { "#text": string };
  };
}

function extractEntries(parsed: YTAtomFeedParsed): YTEntry[] {
  const entries = parsed?.feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

function extractChannelTitle(parsed: YTAtomFeedParsed): string {
  const title = parsed?.feed?.title;
  if (!title) return "YouTube";
  return typeof title === "string" ? title : title["#text"] ?? "YouTube";
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
  const title =
    typeof entry.title === "string"
      ? entry.title
      : entry.title?.["#text"] ?? "(untitled)";

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
  const channelTitle = extractChannelTitle(parsed);
  const entries = extractEntries(parsed);
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
