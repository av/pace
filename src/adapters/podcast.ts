import { XMLParser } from "fast-xml-parser";
import {
  extractAtomLink,
  extractXmlText,
  FEED_XML_PARSER_OPTIONS,
  normalizeXmlList,
  type AtomLinkField,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { joinBodyParts } from "./engagement";
import { fetchText } from "./fetch";
import { sliceToLimit } from "../utils";
import { dedupeByKey } from "./merge";
import { decodeHtmlEntities, stripHtml } from "./html";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

interface PodcastEnclosure {
  "@_url"?: string;
}

type PodcastGuidField =
  | string
  | ({ "@_isPermaLink"?: string } & Record<string, unknown>);

interface PodcastFeedItem {
  title?: XmlTextField;
  link?: AtomLinkField;
  enclosure?: PodcastEnclosure | PodcastEnclosure[];
  guid?: PodcastGuidField;
  pubDate?: string;
  published?: string;
  updated?: string;
  "dc:date"?: string;
  description?: XmlTextField;
  "itunes:summary"?: XmlTextField;
  "itunes:subtitle"?: XmlTextField;
  "content:encoded"?: XmlTextField;
  "itunes:duration"?: string | number;
  "itunes:episode"?: string | number;
  "itunes:season"?: string | number;
  "itunes:author"?: XmlTextField;
  author?: XmlTextField;
}

interface PodcastChannel {
  title?: XmlTextField;
  link?: string;
  item?: PodcastFeedItem | PodcastFeedItem[];
}

/** Parsed RSS 2.0 podcast feed root from fast-xml-parser (attributeNamePrefix "@_"). */
interface PodcastFeedParsed {
  rss?: {
    channel?: PodcastChannel;
  };
}

const parser = new XMLParser({
  ...FEED_XML_PARSER_OPTIONS,
  cdataPropName: "__cdata",
  trimValues: true,
});

/**
 * Parse duration from various formats:
 * - "HH:MM:SS" or "MM:SS" (already formatted)
 * - Seconds as a number or numeric string
 * - "1h 23m 45s" style
 */
function parseDuration(raw: unknown): string | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;

  // Already in HH:MM:SS or MM:SS format
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    return str;
  }

  // Pure number — treat as seconds
  if (/^\d+$/.test(str)) {
    const total = parseInt(str, 10);
    return formatSeconds(total);
  }

  // "1h 23m 45s" or "1h23m45s" etc.
  const hMatch = str.match(/(\d+)\s*h/i);
  const mMatch = str.match(/(\d+)\s*m/i);
  const sMatch = str.match(/(\d+)\s*s/i);
  if (hMatch || mMatch || sMatch) {
    const h = hMatch ? parseInt(hMatch[1], 10) : 0;
    const m = mMatch ? parseInt(mMatch[1], 10) : 0;
    const s = sMatch ? parseInt(sMatch[1], 10) : 0;
    return formatSeconds(h * 3600 + m * 60 + s);
  }

  return null;
}

function formatSeconds(total: number): string {
  if (total <= 0) return "0:00";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Slugify a show name for use in source labels.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

interface PodcastEpisode {
  title: string;
  url: string;
  audioUrl: string;
  guid: string;
  publishDate: Date;
  description: string;
  duration: string | null;
  showName: string;
  episode: string | null;
  season: string | null;
  author: string | null;
}

function extractChannelTitle(channel: PodcastChannel): string {
  return decodeHtmlEntities(
    extractXmlText(channel.title) ?? "Unknown Podcast",
    { numeric: true },
  );
}

function parseEpisode(
  item: PodcastFeedItem,
  showName: string,
  channelLink: string = "",
): PodcastEpisode | null {
  const title = decodeHtmlEntities(extractXmlText(item.title) ?? "", {
    numeric: true,
  });
  if (!title) return null;

  let url = extractAtomLink(item.link);

  let audioUrl = "";
  if (item.enclosure) {
    const enc = Array.isArray(item.enclosure) ? item.enclosure[0] : item.enclosure;
    audioUrl = enc?.["@_url"] ?? "";
    if (!url) url = audioUrl;
  }

  let guid = "";
  let guidIsPermaLink = false;
  const rawGuid = item.guid;
  if (rawGuid) {
    if (typeof rawGuid === "string") {
      guid = rawGuid;
      // If it looks like a URL, treat it as a permalink
      guidIsPermaLink = guid.startsWith("http");
    } else {
      guid = extractXmlText(rawGuid as XmlTextField) ?? "";
      const permaAttr = rawGuid["@_isPermaLink"];
      guidIsPermaLink = permaAttr === "true" || (permaAttr == null && guid.startsWith("http"));
    }
  }

  // If guid is a permalink URL, prefer it as the episode URL (most specific)
  if (guidIsPermaLink && guid) {
    url = guid;
  }

  if (url && channelLink && url === channelLink && audioUrl) {
    url = audioUrl;
  }

  const dateStr =
    item.pubDate ?? item.published ?? item.updated ?? item["dc:date"] ?? "";
  const publishDate = parseFeedDate(dateStr ? String(dateStr) : "");

  const rawDesc =
    extractXmlText(item.description) ??
    extractXmlText(item["itunes:summary"]) ??
    extractXmlText(item["itunes:subtitle"]) ??
    extractXmlText(item["content:encoded"]) ??
    "";
  const description = stripHtml(rawDesc, {
    tagSeparator: " ",
    whitespace: "collapse-all",
    numericEntities: true,
  });

  const duration = parseDuration(item["itunes:duration"]);

  const episode = item["itunes:episode"] != null ? String(item["itunes:episode"]) : null;
  const season = item["itunes:season"] != null ? String(item["itunes:season"]) : null;

  const author =
    extractXmlText(item["itunes:author"]) ??
    extractXmlText(item.author) ??
    null;

  return {
    title,
    url,
    audioUrl,
    guid,
    publishDate,
    description,
    duration,
    showName,
    episode,
    season,
    author,
  };
}

function podcastSeasonEpisode(ep: PodcastEpisode): string | undefined {
  if (ep.season && ep.episode) {
    return `S${ep.season.padStart(2, "0")}E${ep.episode.padStart(2, "0")}`;
  }
  if (ep.episode) return `Ep ${ep.episode}`;
  if (ep.season) return `Season ${ep.season}`;
  return undefined;
}

function buildBody(ep: PodcastEpisode): string {
  const description = ep.description
    ? ep.description.length > 200
      ? ep.description.slice(0, 200) + "..."
      : ep.description
    : undefined;

  return joinBodyParts(
    ep.duration ? `Duration: ${ep.duration}` : undefined,
    `Show: ${ep.showName}`,
    podcastSeasonEpisode(ep),
    description ? `Description: ${description}` : undefined,
    ep.audioUrl ? `Audio: ${ep.audioUrl}` : undefined,
  );
}

function episodeToContentItem(ep: PodcastEpisode): ContentItem {
  const slug = slugify(ep.showName);
  const uniqueId = ep.guid || ep.audioUrl || ep.url || ep.title;
  return {
    id: `podcast:${slug}:${uniqueId}`,
    title: ep.title,
    url: ep.url,
    source: `podcast:${slug}`,
    timestamp: ep.publishDate,
    body: buildBody(ep),
  };
}

async function fetchPodcastFeed(
  feedUrl: string,
  limit: number,
): Promise<ContentItem[]> {
  const xml = await fetchText("podcast", feedUrl, feedUrl, {
    userAgent: "pace/1.0 (podcast aggregator)",
    accept: "application/rss+xml, application/xml, text/xml, */*",
    timeoutMs: 20_000,
  });
  const parsed = parser.parse(xml) as PodcastFeedParsed;

  const channel = parsed.rss?.channel;
  if (!channel) {
    console.warn(`podcast: no channel found in feed ${feedUrl}`);
    return [];
  }

  const showName = extractChannelTitle(channel);
  const channelLink = typeof channel.link === "string" ? channel.link : "";

  const items = normalizeXmlList(channel.item);
  if (items.length === 0) return [];

  const episodes: ContentItem[] = [];
  for (const item of sliceToLimit(items, limit)) {
    const ep = parseEpisode(item, showName, channelLink);
    if (ep) {
      episodes.push(episodeToContentItem(ep));
    }
  }

  return episodes;
}

const adapter: Adapter = {
  name: "podcast",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const feeds = (config.params?.feeds as string[]) ?? [];
    const limit = Math.min((config.params?.limit as number) ?? 10, 50);

    if (feeds.length === 0) return [];

    const results = await Promise.all(
      feeds.map((url) => fetchPodcastFeed(url, limit)),
    );
    return dedupeByKey(results.flat(), (item) => item.url || item.id);
  },
};

export default adapter;
