import { XMLParser } from "fast-xml-parser";
import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  extractXmlText,
  FEED_XML_PARSER_OPTIONS,
  normalizeXmlList,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { joinTitle } from "./title";
import { FEED_FETCH_TIMEOUT_MS, fetchText, PACE_USER_AGENT } from "./fetch";
import {
  clampAdapterLimit,
  normalizeStringList,
  sliceToLimit,
} from "../utils";
import { dedupeByKey } from "./merge";
import {
  decodeNumericFeedTitle,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

interface PodcastEnclosure {
  "@_url"?: string;
}

type PodcastGuidField =
  | string
  | ({ "@_isPermaLink"?: string } & Record<string, unknown>);

interface PodcastFeedItem extends FeedItemBodyFields {
  title?: XmlTextField;
  link?: AtomLinkField;
  enclosure?: PodcastEnclosure | PodcastEnclosure[];
  guid?: PodcastGuidField;
  pubDate?: string;
  published?: string;
  updated?: string;
  "dc:date"?: string;
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

interface PodcastFeedParsed {
  rss?: {
    channel?: PodcastChannel;
  };
  feed?: {
    title?: XmlTextField;
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

  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    return str;
  }

  if (/^\d+$/.test(str)) {
    const total = parseInt(str, 10);
    return formatSeconds(total);
  }

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

function extractChannelTitle(
  channel: PodcastChannel,
  atomTitle?: XmlTextField,
): string {
  return decodeNumericFeedTitle(
    extractFeedRootTitle(channel.title, atomTitle) ?? "Unknown Podcast",
  );
}

function parseEpisode(
  item: PodcastFeedItem,
  showName: string,
  channelLink: string = "",
): PodcastEpisode | null {
  const title = decodeNumericFeedTitle(extractFeedEntryTitle(item.title, ""));
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
      guidIsPermaLink = guid.startsWith("http");
    } else {
      guid = extractXmlText(rawGuid as XmlTextField) ?? "";
      const permaAttr = rawGuid["@_isPermaLink"];
      guidIsPermaLink = permaAttr === "true" || (permaAttr == null && guid.startsWith("http"));
    }
  }

  if (guidIsPermaLink && guid) {
    url = guid;
  }

  if (url && channelLink && url === channelLink && audioUrl) {
    url = audioUrl;
  }

  const dateStr =
    item.pubDate ?? item.published ?? item.updated ?? item["dc:date"] ?? "";
  const publishDate = parseFeedDate(dateStr ? String(dateStr) : "");

  const rawDesc = extractFeedItemBody(item) ?? "";
  const description = stripHtml(rawDesc, FEED_BODY_STRIP_OPTIONS);

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

  return joinTitle(
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
    userAgent: `${PACE_USER_AGENT} (podcast aggregator)`,
    accept: "application/rss+xml, application/xml, text/xml, */*",
    timeoutMs: FEED_FETCH_TIMEOUT_MS,
  });
  const parsed = parser.parse(xml) as PodcastFeedParsed;

  const channel = parsed.rss?.channel;
  if (!channel) {
    console.warn(`podcast: no channel found in feed ${feedUrl}`);
    return [];
  }

  const showName = extractChannelTitle(channel, parsed.feed?.title);
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
    const feeds = normalizeStringList((config.params?.feeds as string[]) ?? []);
    const limit = clampAdapterLimit(config.params?.limit, 10, 50);

    if (feeds.length === 0) {
      console.warn("podcast: no feeds configured");
      return [];
    }

    const results = await Promise.all(
      feeds.map((url) => fetchPodcastFeed(url, limit)),
    );
    return dedupeByKey(results.flat(), (item) => item.url || item.id);
  },
};

export default adapter;
