import { XMLParser } from "fast-xml-parser";
import { extractAtomLink } from "./atom";
import { parseFeedDate, sliceToLimit } from "./dates";
import { fetchWithTimeout } from "./fetch";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

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

/** Parsed Atom feed root from fast-xml-parser (attributeNamePrefix "@_"). */
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

  const description = entry["media:group"]?.["media:description"] ?? undefined;

  return {
    id: `youtube:${videoId || title}`,
    title: String(title),
    url: link,
    source: `youtube:${channelTitle}`,
    timestamp,
    body: description ? String(description) : undefined,
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
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      throw new Error(`youtube: failed to fetch ${label} ${id}: ${errorMessage({ message: String(res.status) })}`);
    }
    const xml = await res.text();
    const parsed = parser.parse(xml) as YTAtomFeedParsed;
    const channelTitle = extractChannelTitle(parsed);
    const entries = extractEntries(parsed);
    return sliceToLimit(entries, limit).map((entry) => parseEntry(entry, channelTitle));
  } catch (err) {
    throw new Error(`youtube: error fetching ${label} ${id}: ${errorMessage(err)}`);
  }
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
    return results.flat();
  },
};

export default adapter;
