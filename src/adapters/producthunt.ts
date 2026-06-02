import { XMLParser } from "fast-xml-parser";
import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  FEED_XML_PARSER_OPTIONS,
  normalizeXmlList,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { sliceToLimit } from "../utils";
import { fetchText } from "./fetch";
import {
  decodeHtmlEntities,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";
import {
  RE_POINTS_OR_UPVOTES,
  formatBy,
  formatComments,
  formatSite,
  formatTopics,
  formatUpvotes,
  joinBodyParts,
  parseFirstIntMatch,
} from "./engagement";
import { titleWithTagline } from "./title";

const PH_ENRICH_USER_AGENT =
  "Mozilla/5.0 (compatible; pace/1.0; +https://github.com/nickvdyck/pace)";
const ENRICH_FETCH_TIMEOUT_MS = 10_000;

const PH_FEED_URL = "https://www.producthunt.com/feed";
const ENRICH_BATCH_SIZE = 5;
const ENRICH_DELAY_MS = 500;

const RE_ENRICH_COMMENTS = /commentsCount":\s*(\d+)/;
const RE_ENRICH_TOPIC_LABEL = /data-test="topic[^"]*"[^>]*>([^<]+)</gi;
const RE_ENRICH_TOPIC_SLUG = /href="\/topics\/([^"]+)"/gi;
const RE_ENRICH_PROFILE = /href="\/@([a-zA-Z0-9_]{2,30})"/gi;

const EXCLUDED_MAKER_HANDLES = new Set(["producthunt", "product_hunt"]);

const parser = new XMLParser(FEED_XML_PARSER_OPTIONS);

interface PHEntry extends FeedItemBodyFields {
  id?: string;
  title?: XmlTextField;
  link?: AtomLinkField;
  published?: string;
  updated?: string;
  author?: { name?: string };
}

/** Parsed Atom feed root from fast-xml-parser (attributeNamePrefix "@_"). */
interface PHAtomFeedParsed {
  feed?: {
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
  // Extract the product link before stripping (needs href in markup).
  const linkMatch = raw.match(
    /href="(https:\/\/www\.producthunt\.com\/r\/[^"]+)"/,
  );
  const productLink = linkMatch ? linkMatch[1] : "";

  const html = decodeHtmlEntities(raw, { numeric: true });
  const firstParagraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  let tagline = "";
  if (firstParagraph) {
    tagline = stripHtml(firstParagraph[1], FEED_BODY_STRIP_OPTIONS);
  } else {
    // Fallback: strip everything but remove "Discussion | Link" noise
    tagline = stripHtml(html, FEED_BODY_STRIP_OPTIONS)
      .replace(/Discussion\s*\|\s*Link/gi, "")
      .trim();
  }

  return { tagline, productLink };
}

function warnEnrichFailed(url: string, err: unknown): void {
  const msg = errorMessage(err);
  console.warn(
    msg.startsWith("producthunt:")
      ? msg
      : `producthunt: enrich failed for ${url}: ${msg}`,
  );
}

function matchCaptures(html: string, re: RegExp): string[] {
  return [...html.matchAll(re)].map((m) => m[1]).filter(Boolean);
}

function topicLabelFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function decodeTopicLabel(label: string): string {
  return decodeHtmlEntities(label.trim(), { numeric: true });
}

function extractTopics(html: string): string[] {
  const labels = matchCaptures(html, RE_ENRICH_TOPIC_LABEL)
    .map(decodeTopicLabel)
    .filter(Boolean);
  if (labels.length > 0) return labels;

  const slugs = [...new Set(matchCaptures(html, RE_ENRICH_TOPIC_SLUG))];
  return slugs.map(topicLabelFromSlug).filter(Boolean);
}

function extractMakers(html: string): string[] {
  const handles = [...new Set(
    matchCaptures(html, RE_ENRICH_PROFILE).filter(
      (h) => !EXCLUDED_MAKER_HANDLES.has(h.toLowerCase()),
    ),
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
      timeoutMs: ENRICH_FETCH_TIMEOUT_MS,
      userAgent: PH_ENRICH_USER_AGENT,
      accept: "text/html",
    });
    return parseEnrichedData(html);
  } catch (err) {
    warnEnrichFailed(url, err);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return joinBodyParts(
    cleanTagline || undefined,
    enriched?.upvotes !== undefined ? formatUpvotes(enriched.upvotes) : undefined,
    enriched?.comments !== undefined ? formatComments(enriched.comments) : undefined,
    enriched?.topics?.length ? formatTopics(enriched.topics) : undefined,
    byAuthor,
    productLink ? formatSite(productLink) : undefined,
  );
}

async function fetchProductHuntFeed(): Promise<
  Array<{
    id: string;
    title: string;
    tagline: string;
    url: string;
    productLink: string;
    author: string;
    timestamp: Date;
  }>
> {
  const xml = await fetchText("producthunt", PH_FEED_URL, "feed", {
    userAgent: "pace:feed-aggregator/1.0",
    accept: "application/atom+xml, application/xml, text/xml",
  });

  const parsed = parser.parse(xml) as PHAtomFeedParsed;
  const entries = normalizeXmlList(parsed.feed?.entry);

  if (entries.length === 0) {
    console.warn("producthunt: no entries found in feed");
    return [];
  }

  return entries.map((entry) => {
    const title = decodeHtmlEntities(extractFeedEntryTitle(entry.title), {
      numeric: true,
    });
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
}

const adapter: Adapter = {
  name: "producthunt",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const limit = Math.min((config.params?.limit as number) ?? 20, 50);
    const minUpvotes = (config.params?.min_upvotes as number) ?? 0;
    const enrich = (config.params?.enrich as boolean) ?? false;

    let items = await fetchProductHuntFeed();

    // Apply limit before enriching (enrichment is expensive)
    items = sliceToLimit(items, limit);

    // Optionally enrich with page scraping for upvotes/topics
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
        // Rate-limit between batches
        if (i + ENRICH_BATCH_SIZE < items.length) {
          await sleep(ENRICH_DELAY_MS);
        }
      }
    }

    // Filter by minimum upvotes if enrichment was enabled and threshold set
    let filtered = items;
    if (enrich && minUpvotes > 0) {
      filtered = items.filter((item) => {
        const data = enrichedMap.get(item.id);
        return data?.upvotes !== undefined && data.upvotes >= minUpvotes;
      });
    }

    return filtered.map((item) => {
      const enriched = enrichedMap.get(item.id) ?? null;

      return {
        id: `ph:${item.id}`,
        title: titleWithTagline(item.title, item.tagline, 0),
        url: item.url,
        source: "producthunt",
        timestamp: item.timestamp,
        body: buildBody(item.tagline, item.author, item.productLink, enriched),
      };
    });
  },
};

export default adapter;
