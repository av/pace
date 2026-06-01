import { XMLParser } from "fast-xml-parser";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Preserve CDATA content
  cdataPropName: "__cdata",
  trimValues: true,
});

/**
 * Decode common HTML/XML entities.
 */
function decodeEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

/**
 * Strip HTML tags from a string and collapse whitespace.
 */
function stripHtml(html: string): string {
  return decodeEntities(
    html.replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract text content from a field that may be a string, an object with #text or __cdata.
 */
function extractText(field: unknown): string {
  if (field == null) return "";
  if (typeof field === "string") return field;
  if (typeof field === "number") return String(field);
  if (typeof field === "object") {
    const obj = field as Record<string, unknown>;
    if (obj.__cdata) return String(obj.__cdata);
    if (obj["#text"]) return String(obj["#text"]);
  }
  return String(field);
}

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

function extractChannelTitle(channel: any): string {
  const title = channel?.title;
  return decodeEntities(extractText(title) || "Unknown Podcast");
}

function parseEpisode(item: any, showName: string, channelLink: string = ""): PodcastEpisode | null {
  // Title
  const title = decodeEntities(extractText(item.title));
  if (!title) return null;

  // Link / URL
  let url = "";
  if (typeof item.link === "string") {
    url = item.link;
  } else if (item.link?.["@_href"]) {
    url = item.link["@_href"];
  } else if (Array.isArray(item.link)) {
    const alt = item.link.find((l: any) => l["@_rel"] === "alternate");
    url = alt?.["@_href"] ?? item.link[0]?.["@_href"] ?? "";
  }

  // Audio URL from enclosure
  let audioUrl = "";
  if (item.enclosure) {
    const enc = Array.isArray(item.enclosure) ? item.enclosure[0] : item.enclosure;
    audioUrl = enc?.["@_url"] ?? "";
    // If no link, use enclosure URL as the episode URL
    if (!url) url = audioUrl;
  }

  // GUID — unique identifier for the episode
  let guid = "";
  let guidIsPermaLink = false;
  if (item.guid) {
    if (typeof item.guid === "string") {
      guid = item.guid;
      // If it looks like a URL, treat it as a permalink
      guidIsPermaLink = guid.startsWith("http");
    } else {
      guid = extractText(item.guid);
      const permaAttr = item.guid["@_isPermaLink"];
      guidIsPermaLink = permaAttr === "true" || (permaAttr == null && guid.startsWith("http"));
    }
  }

  // If guid is a permalink URL, prefer it as the episode URL (most specific)
  if (guidIsPermaLink && guid) {
    url = guid;
  }

  // If the link is the same as the channel homepage (not episode-specific),
  // use the audio enclosure URL instead so episodes have unique URLs
  if (url && channelLink && url === channelLink && audioUrl) {
    url = audioUrl;
  }

  // Publish date — try multiple date fields and formats
  const dateStr =
    item.pubDate ?? item.published ?? item.updated ?? item["dc:date"] ?? "";
  let publishDate = new Date();
  if (dateStr) {
    const parsed = new Date(String(dateStr));
    if (!isNaN(parsed.getTime())) {
      publishDate = parsed;
    }
  }

  // Description — try multiple fields, strip HTML
  const rawDesc =
    extractText(item.description) ||
    extractText(item["itunes:summary"]) ||
    extractText(item["itunes:subtitle"]) ||
    extractText(item["content:encoded"]) ||
    "";
  const description = stripHtml(rawDesc);

  // Duration from itunes:duration
  const duration = parseDuration(item["itunes:duration"]);

  // Episode and season numbers
  const episode = item["itunes:episode"] != null ? String(item["itunes:episode"]) : null;
  const season = item["itunes:season"] != null ? String(item["itunes:season"]) : null;

  // Author
  const author =
    extractText(item["itunes:author"]) ||
    extractText(item.author) ||
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

function buildBody(ep: PodcastEpisode): string {
  const parts: string[] = [];

  if (ep.duration) {
    parts.push(`Duration: ${ep.duration}`);
  }

  parts.push(`Show: ${ep.showName}`);

  // Episode/season notation
  if (ep.season && ep.episode) {
    parts.push(`S${ep.season.padStart(2, "0")}E${ep.episode.padStart(2, "0")}`);
  } else if (ep.episode) {
    parts.push(`Ep ${ep.episode}`);
  } else if (ep.season) {
    parts.push(`Season ${ep.season}`);
  }

  // Truncated description
  if (ep.description) {
    const truncated =
      ep.description.length > 200
        ? ep.description.slice(0, 200) + "..."
        : ep.description;
    parts.push(`Description: ${truncated}`);
  }

  if (ep.audioUrl) {
    parts.push(`Audio: ${ep.audioUrl}`);
  }

  return parts.join(" | ");
}

function episodeToContentItem(ep: PodcastEpisode): ContentItem {
  const slug = slugify(ep.showName);
  // Use guid (most unique), then audioUrl, then url, then title for ID uniqueness
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
  try {
    const res = await fetch(feedUrl, {
      headers: {
        "User-Agent": "pace/1.0 (podcast aggregator)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      throw new Error(`podcast: failed to fetch ${feedUrl}: ${errorMessage({ message: String(res.status) })}`);
    }
    const xml = await res.text();
    const parsed = parser.parse(xml);

    // Extract channel info (RSS 2.0 structure)
    const channel = parsed?.rss?.channel;
    if (!channel) {
      console.warn(`podcast: no channel found in feed ${feedUrl}`);
      return [];
    }

    const showName = extractChannelTitle(channel);
    // Channel-level link (podcast homepage)
    const channelLink = typeof channel.link === "string" ? channel.link : "";

    // Extract items
    let items = channel.item;
    if (!items) return [];
    if (!Array.isArray(items)) items = [items];

    const episodes: ContentItem[] = [];
    for (const item of items.slice(0, limit)) {
      const ep = parseEpisode(item, showName, channelLink);
      if (ep) {
        episodes.push(episodeToContentItem(ep));
      }
    }

    return episodes;
  } catch (err) {
    throw new Error(`podcast: error fetching ${feedUrl}: ${errorMessage(err)}`);
  }
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
    return results.flat();
  },
};

export default adapter;
