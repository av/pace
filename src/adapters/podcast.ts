import {
  extractAtomLink,
  extractXmlText,
  podcastFeedXmlParser,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { formatSeconds } from "./dates";
import { warnEmptyConfig, warnEmptyFetchResult } from "./empty-config";
import { mapToContentItemsPerSource, type ContentItemProjection } from "./content-item";
import {
  decodeFeedEntryTitle,
  extractFeedEntryStrippedBody,
  FEED_ENTRY_DATE_PODCAST_ORDER,
  parseFeedEntryTimestamp,
  resolveDecodedFeedRootTitle,
} from "./feed-entry";
import { joinTitle, truncateText } from "./title";
import {
  FEED_FETCH_TIMEOUT_MS,
  fetchRssAtomFeed,
  PACE_USER_AGENT,
} from "./fetch";
import {
  clampAdapterLimit,
  normalizeParamStringList,
  slugify,
} from "../utils";
import {
  aggregateParallelFeeds,
  sliceAndMapDefined,
} from "./merge";

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

interface TaggedPodcastEpisode {
  episode: PodcastEpisode;
  timestamp: Date;
}

function podcastUniqueId(ep: PodcastEpisode): string {
  return ep.guid || ep.audioUrl || ep.url || ep.title;
}

function podcastDedupeKey(item: TaggedPodcastEpisode): string {
  const ep = item.episode;
  if (ep.url) return ep.url;
  return `podcast:${slugify(ep.showName)}:${podcastUniqueId(ep)}`;
}

function parseEpisode(
  item: PodcastFeedItem,
  showName: string,
  channelLink: string = "",
): PodcastEpisode | null {
  const title = decodeFeedEntryTitle(item.title, "");
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

  const publishDate = parseFeedEntryTimestamp(item, FEED_ENTRY_DATE_PODCAST_ORDER);
  const description = extractFeedEntryStrippedBody(item) ?? "";

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
    ? truncateText(ep.description, 200, {
        ellipsis: "...",
        inclusive: false,
        trim: false,
      })
    : undefined;

  return joinTitle(
    ep.duration ? `Duration: ${ep.duration}` : undefined,
    `Show: ${ep.showName}`,
    podcastSeasonEpisode(ep),
    description ? `Description: ${description}` : undefined,
    ep.audioUrl ? `Audio: ${ep.audioUrl}` : undefined,
  );
}

function projectPodcastEpisode(item: TaggedPodcastEpisode): ContentItemProjection {
  const ep = item.episode;
  const slug = slugify(ep.showName);
  return {
    id: `podcast:${slug}:${podcastUniqueId(ep)}`,
    title: ep.title,
    url: ep.url,
    timestamp: item.timestamp,
    body: buildBody(ep),
  };
}

async function fetchPodcastFeed(
  feedUrl: string,
  limit: number,
): Promise<TaggedPodcastEpisode[]> {
  const { parsed, items } = await fetchRssAtomFeed<PodcastFeedItem, PodcastFeedParsed>(
    "podcast",
    feedUrl,
    feedUrl,
    {
      userAgent: `${PACE_USER_AGENT} (podcast aggregator)`,
      timeoutMs: FEED_FETCH_TIMEOUT_MS,
      parser: podcastFeedXmlParser,
    },
  );

  const channel = parsed.rss?.channel;
  if (!channel) {
    warnEmptyFetchResult("podcast", "channel", `feed ${feedUrl}`);
    return [];
  }

  const showName = resolveDecodedFeedRootTitle(
    channel.title,
    parsed.feed?.title,
    "Unknown Podcast",
  )!;
  const channelLink = typeof channel.link === "string" ? channel.link : "";

  return sliceAndMapDefined(items, limit, (item) => {
    const ep = parseEpisode(item, showName, channelLink);
    return ep ? { episode: ep, timestamp: ep.publishDate } : null;
  });
}

const adapter: Adapter = {
  name: "podcast",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const feeds = normalizeParamStringList(config.params, "feeds");
    const limit = clampAdapterLimit(config.params?.limit, 10, 50);

    if (feeds.length === 0) {
      return warnEmptyConfig("podcast", "no feeds configured");
    }

    const tagged = await aggregateParallelFeeds(
      feeds,
      (url) => fetchPodcastFeed(url, limit),
      {
        perSourceLimit: limit,
        dedupeKey: podcastDedupeKey,
      },
    );

    return mapToContentItemsPerSource(
      tagged,
      (item) => `podcast:${slugify(item.episode.showName)}`,
      projectPodcastEpisode,
    );
  },
};

export default adapter;
