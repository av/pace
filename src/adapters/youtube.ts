import { XMLParser } from "fast-xml-parser";
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

function extractEntries(parsed: any): YTEntry[] {
  const entries = parsed?.feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

function extractChannelTitle(parsed: any): string {
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

  let link = "";
  if (videoId) {
    link = `https://www.youtube.com/watch?v=${videoId}`;
  } else if (entry.link) {
    if (Array.isArray(entry.link)) {
      const alt = entry.link.find((l) => l["@_rel"] === "alternate");
      link = alt?.["@_href"] ?? entry.link[0]?.["@_href"] ?? "";
    } else {
      link = entry.link["@_href"] ?? "";
    }
  }

  const dateStr = entry.published ?? "";
  const parsed = dateStr ? new Date(dateStr) : new Date();
  const timestamp = isNaN(parsed.getTime()) ? new Date() : parsed;

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

async function fetchChannelFeed(
  channelId: string,
  limit: number,
): Promise<ContentItem[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "pace/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`youtube: failed to fetch channel ${channelId}: ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const channelTitle = extractChannelTitle(parsed);
    const entries = extractEntries(parsed);
    return entries.slice(0, limit).map((entry) => parseEntry(entry, channelTitle));
  } catch (err) {
    console.warn(`youtube: error fetching channel ${channelId}:`, err);
    return [];
  }
}

async function fetchPlaylistFeed(
  playlistId: string,
  limit: number,
): Promise<ContentItem[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "pace/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`youtube: failed to fetch playlist ${playlistId}: ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parsed = parser.parse(xml);
    const channelTitle = extractChannelTitle(parsed);
    const entries = extractEntries(parsed);
    return entries.slice(0, limit).map((entry) => parseEntry(entry, channelTitle));
  } catch (err) {
    console.warn(`youtube: error fetching playlist ${playlistId}:`, err);
    return [];
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
      ...channels.map((ch) => fetchChannelFeed(ch, limit)),
      ...playlists.map((pl) => fetchPlaylistFeed(pl, limit)),
    ]);
    return results.flat();
  },
};

export default adapter;
