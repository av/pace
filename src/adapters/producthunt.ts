import {
  extractAtomLink,
  extractFeedItemBody,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import {
  buildFeedContentItem,
  FEED_ENTRY_DATE_ATOM_ORDER,
  projectFeedEntryToContentItem,
  resolveDecodedFeedRootTitle,
} from "./feed-entry";
import {
  clampAdapterLimit,
  normalizeNonNegativeNumber,
  normalizeParamBoolean,
} from "../utils";
import { fetchAllBatched, finalizeFetchedItems, sliceAndMap } from "./merge";
import {
  fetchAtomFeed,
  fetchText,
  HN_ITEM_FETCH_TIMEOUT_MS,
  tryOptionalFetch,
} from "./fetch";
import {
  decodeNumericFeedTitle,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import {
  RE_POINTS_OR_UPVOTES,
  formatBy,
  formatComments,
  formatSite,
  formatTopics,
  formatUpvotes,
  parseFirstIntMatch,
} from "./engagement";
import { joinTitle, joinTitleWithTagline } from "./title";

const PH_ENRICH_USER_AGENT =
  "Mozilla/5.0 (compatible; pace/1.0; +https://github.com/nickvdyck/pace)";

const PH_FEED_URL = "https://www.producthunt.com/feed";
const ENRICH_BATCH_SIZE = 5;
const ENRICH_DELAY_MS = 500;

const RE_ENRICH_COMMENTS = /commentsCount":\s*(\d+)/;
const RE_ENRICH_TOPIC =
  /data-test="topic[^"]*"[^>]*>([^<]+)<|href="\/topics\/([^"]+)"/gi;
const RE_ENRICH_PROFILE = /href="\/@([a-zA-Z0-9_]{2,30})"/gi;

const EXCLUDED_MAKER_HANDLES = new Set(["producthunt", "product_hunt"]);

interface PHEntry extends FeedItemBodyFields {
  id?: string;
  title?: XmlTextField;
  link?: AtomLinkField;
  published?: string;
  updated?: string;
  author?: { name?: string };
}

interface PHAtomFeedParsed {
  feed?: {
    title?: XmlTextField;
    entry?: PHEntry | PHEntry[];
  };
}

interface EnrichedData {
  upvotes?: number;
  comments?: number;
  topics?: string[];
  makers?: string[];
}

function extractContent(entry: PHEntry): { tagline: string; productLink: string } {
  const raw = extractFeedItemBody(entry) ?? "";
  if (!raw) return { tagline: "", productLink: "" };

  const linkMatch = raw.match(
    /href="(https:\/\/www\.producthunt\.com\/r\/[^"]+)"/,
  );
  const productLink = linkMatch ? linkMatch[1] : "";

  const html = decodeNumericFeedTitle(raw);
  const firstParagraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  let tagline = "";
  if (firstParagraph) {
    tagline = stripHtml(firstParagraph[1], FEED_BODY_STRIP_OPTIONS);
  } else {
    tagline = stripHtml(html, FEED_BODY_STRIP_OPTIONS)
      .replace(/Discussion\s*\|\s*Link/gi, "")
      .trim();
  }

  return { tagline, productLink };
}

function topicLabelFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractTopics(html: string): string[] {
  const labels: string[] = [];
  const slugs: string[] = [];
  for (const m of html.matchAll(RE_ENRICH_TOPIC)) {
    if (m[1]) labels.push(decodeNumericFeedTitle(m[1].trim()));
    else if (m[2]) slugs.push(m[2]);
  }
  if (labels.length > 0) return labels.filter(Boolean);
  return [...new Set(slugs)].map(topicLabelFromSlug).filter(Boolean);
}

function extractMakers(html: string): string[] {
  const handles = [...new Set(
    [...html.matchAll(RE_ENRICH_PROFILE)]
      .map((m) => m[1])
      .filter(Boolean)
      .filter((h) => !EXCLUDED_MAKER_HANDLES.has(h.toLowerCase())),
  )].slice(0, 3);
  return handles.map((h) => `@${h}`);
}

function parseEnrichedData(html: string): EnrichedData {
  const data: EnrichedData = {};

  const upvotes = parseFirstIntMatch(html, RE_POINTS_OR_UPVOTES);
  if (upvotes !== undefined) data.upvotes = upvotes;

  const topics = extractTopics(html);
  if (topics.length > 0) data.topics = topics;

  const comments = parseFirstIntMatch(html, RE_ENRICH_COMMENTS);
  if (comments !== undefined) data.comments = comments;

  const makers = extractMakers(html);
  if (makers.length > 0) data.makers = makers;

  return data;
}

function extractId(entry: PHEntry): string {
  if (entry.id) {
    const match = entry.id.match(/Post\/(\d+)/);
    if (match) return match[1];
    return entry.id;
  }
  return extractAtomLink(entry.link);
}

interface ParsedPHEntry {
  content: ContentItem;
  tagline: string;
  productLink: string;
  author: string;
}

function parseEntry(entry: PHEntry, feedTitle: string): ParsedPHEntry {
  const { tagline, productLink } = extractContent(entry);
  const author = entry.author?.name ?? "";
  const content = projectFeedEntryToContentItem(
    "ph",
    entry,
    () => ({
      idSuffix: extractId(entry),
      url: extractAtomLink(entry.link),
      source: feedTitle,
    }),
    FEED_ENTRY_DATE_ATOM_ORDER,
  );
  return { content, tagline, productLink, author };
}

function toContentItem(
  parsed: ParsedPHEntry,
  enriched: EnrichedData | null,
): ContentItem {
  const { content, tagline, productLink, author } = parsed;
  return buildFeedContentItem(content.id, {
    title: joinTitleWithTagline(content.title, tagline, 0),
    url: content.url,
    source: content.source,
    timestamp: content.timestamp,
    body: buildBody(tagline, author, productLink, enriched),
  });
}

async function enrichProduct(url: string): Promise<EnrichedData | null> {
  const html = await tryOptionalFetch("producthunt", `enrich failed for ${url}`, () =>
    fetchText("producthunt", url, url, {
      timeoutMs: HN_ITEM_FETCH_TIMEOUT_MS,
      userAgent: PH_ENRICH_USER_AGENT,
      accept: "text/html",
    }),
  );
  return html ? parseEnrichedData(html) : null;
}

function buildBody(
  tagline: string,
  author: string,
  productLink: string,
  enriched: EnrichedData | null,
): string {
  const cleanTagline = tagline
    ? stripHtml(tagline, FEED_BODY_STRIP_OPTIONS)
    : "";
  const byAuthor = enriched?.makers?.length
    ? formatBy(enriched.makers.join(", "))
    : author
      ? formatBy(author)
      : undefined;
  return joinTitle(
    cleanTagline || undefined,
    enriched?.upvotes !== undefined ? formatUpvotes(enriched.upvotes) : undefined,
    enriched?.comments !== undefined ? formatComments(enriched.comments) : undefined,
    enriched?.topics?.length ? formatTopics(enriched.topics) : undefined,
    byAuthor,
    productLink ? formatSite(productLink) : undefined,
  );
}

async function fetchProductHuntFeed(limit: number): Promise<{
  feedTitle: string;
  items: ParsedPHEntry[];
}> {
  const { parsed, entries } = await fetchAtomFeed<PHEntry, PHAtomFeedParsed>(
    "producthunt",
    PH_FEED_URL,
    "feed",
  );
  const feedTitle = resolveDecodedFeedRootTitle(
    undefined,
    parsed.feed?.title,
    "producthunt",
  )!;

  const items = sliceAndMap(entries, limit, (entry) =>
    parseEntry(entry, feedTitle),
  );
  return { feedTitle, items };
}

const adapter: Adapter = {
  name: "producthunt",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const limitRaw = config.params?.limit;
    const limit =
      limitRaw !== undefined
        ? clampAdapterLimit(limitRaw, 20, 50)
        : undefined;
    const minUpvotes = normalizeNonNegativeNumber(config.params?.min_upvotes);
    const enrich = normalizeParamBoolean(config.params, "enrich");

    if (minUpvotes > 0 && !enrich) {
      console.warn(
        "producthunt: min_upvotes has no effect without enrich: true",
      );
    }

    const effectiveLimit = limit ?? Number.MAX_SAFE_INTEGER;
    const { items: feedItems } = await fetchProductHuntFeed(effectiveLimit);

    const items = finalizeFetchedItems(feedItems, {
      limit: effectiveLimit,
    });

    let enrichedMap = new Map<string, EnrichedData | null>();
    if (enrich) {
      console.warn(
        `producthunt: enriching ${items.length} items (this may take a moment)...`,
      );
      const enrichResults = await fetchAllBatched(
        items,
        ENRICH_BATCH_SIZE,
        (item) => enrichProduct(item.content.url),
        ENRICH_DELAY_MS,
      );
      for (let i = 0; i < items.length; i++) {
        enrichedMap.set(items[i].content.id, enrichResults[i]);
      }
    }

    let filtered = items;
    if (enrich && minUpvotes > 0) {
      filtered = items.filter((item) => {
        const data = enrichedMap.get(item.content.id);
        return data?.upvotes !== undefined && data.upvotes >= minUpvotes;
      });
      if (items.length > 0 && filtered.length === 0) {
        console.warn(
          `producthunt: min_upvotes (${minUpvotes}) filtered all ${items.length} enriched item(s)`,
        );
      }
    }

    return filtered.map((parsed) =>
      toContentItem(parsed, enrichedMap.get(parsed.content.id) ?? null),
    );
  },
};

export default adapter;
