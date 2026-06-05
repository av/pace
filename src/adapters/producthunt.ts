import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  feedXmlParser,
  normalizeXmlList,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import {
  clampAdapterLimit,
  normalizeNonNegativeNumber,
  sleep,
  sliceToLimit,
} from "../utils";
import { fetchText, HN_ITEM_FETCH_TIMEOUT_MS, warnOptionalFetchFailure } from "./fetch";
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
/** Prefer data-test topic labels; else capture /topics/{slug} hrefs. */
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

  // The content has HTML structure:
  // <p>Tagline text</p>
  // <p><a href="...">Discussion</a> | <a href="...product link...">Link</a></p>
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
  // id format: "tag:www.producthunt.com,2005:Post/1143406"
  if (entry.id) {
    const match = entry.id.match(/Post\/(\d+)/);
    if (match) return match[1];
    return entry.id;
  }
  return extractAtomLink(entry.link);
}

async function enrichProduct(url: string): Promise<EnrichedData | null> {
  try {
    const html = await fetchText("producthunt", url, url, {
      timeoutMs: HN_ITEM_FETCH_TIMEOUT_MS,
      userAgent: PH_ENRICH_USER_AGENT,
      accept: "text/html",
    });
    return parseEnrichedData(html);
  } catch (err) {
    warnOptionalFetchFailure("producthunt", err, `enrich failed for ${url}`);
    return null;
  }
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

async function fetchProductHuntFeed(): Promise<{
  feedTitle: string;
  items: Array<{
    id: string;
    title: string;
    tagline: string;
    url: string;
    productLink: string;
    author: string;
    timestamp: Date;
  }>;
}> {
  const xml = await fetchText("producthunt", PH_FEED_URL, "feed", {
    accept: "application/atom+xml, application/xml, text/xml",
  });

  const parsed = feedXmlParser.parse(xml) as PHAtomFeedParsed;
  const feedTitle = decodeNumericFeedTitle(
    extractFeedRootTitle(undefined, parsed.feed?.title) ?? "producthunt",
  );
  const entries = normalizeXmlList(parsed.feed?.entry);

  if (entries.length === 0) {
    console.warn("producthunt: no entries found in feed");
    return { feedTitle, items: [] };
  }

  const items = entries.map((entry) => {
    const title = decodeNumericFeedTitle(extractFeedEntryTitle(entry.title));
    const url = extractAtomLink(entry.link);
    const { tagline, productLink } = extractContent(entry);
    const author = entry.author?.name ?? "";
    const timestamp = parseFeedDate(entry.published ?? entry.updated ?? "");

    return {
      id: extractId(entry),
      title,
      tagline,
      url,
      productLink,
      author,
      timestamp,
    };
  });
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
    const enrich = (config.params?.enrich as boolean) ?? false;

    if (minUpvotes > 0 && !enrich) {
      console.warn(
        "producthunt: min_upvotes has no effect without enrich: true",
      );
    }

    const { feedTitle, items: feedItems } = await fetchProductHuntFeed();

    let items =
      limit !== undefined ? sliceToLimit(feedItems, limit) : feedItems;

    let enrichedMap = new Map<string, EnrichedData | null>();
    if (enrich) {
      console.warn(
        `producthunt: enriching ${items.length} items (this may take a moment)...`,
      );
      for (let i = 0; i < items.length; i += ENRICH_BATCH_SIZE) {
        const batch = items.slice(i, i + ENRICH_BATCH_SIZE);
        const results = await Promise.all(
          batch.map((item) => enrichProduct(item.url)),
        );
        for (let j = 0; j < batch.length; j++) {
          enrichedMap.set(batch[j].id, results[j]);
        }
        if (i + ENRICH_BATCH_SIZE < items.length) {
          await sleep(ENRICH_DELAY_MS);
        }
      }
    }

    let filtered = items;
    if (enrich && minUpvotes > 0) {
      filtered = items.filter((item) => {
        const data = enrichedMap.get(item.id);
        return data?.upvotes !== undefined && data.upvotes >= minUpvotes;
      });
      if (items.length > 0 && filtered.length === 0) {
        console.warn(
          `producthunt: min_upvotes (${minUpvotes}) filtered all ${items.length} enriched item(s)`,
        );
      }
    }

    return filtered.map((item) => {
      const enriched = enrichedMap.get(item.id) ?? null;

      return {
        id: `ph:${item.id}`,
        title: joinTitleWithTagline(item.title, item.tagline, 0),
        url: item.url,
        source: feedTitle,
        timestamp: item.timestamp,
        body: buildBody(item.tagline, item.author, item.productLink, enriched),
      };
    });
  },
};

export default adapter;
