import { XMLParser } from "fast-xml-parser";
import { parseFeedDate } from "./dates";
import { sliceToLimit } from "./merge";
import { fetchWithTimeout } from "./fetch";
import { stripHtml } from "./html";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";
import { titleWithTagline } from "./title";

const PH_ENRICH_USER_AGENT =
  "Mozilla/5.0 (compatible; pace/1.0; +https://github.com/nickvdyck/pace)";
const ENRICH_FETCH_TIMEOUT_MS = 10_000;

const PH_FEED_URL = "https://www.producthunt.com/feed";
const ENRICH_BATCH_SIZE = 5;
const ENRICH_DELAY_MS = 500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

interface PHEntry {
  id?: string;
  title?: string | { "#text": string };
  content?: string | { "#text": string };
  link?:
    | { "@_href"?: string }
    | Array<{ "@_href"?: string; "@_rel"?: string }>;
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
  website?: string;
}

function extractEntries(parsed: PHAtomFeedParsed): PHEntry[] {
  const entries = parsed?.feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

function extractTitle(entry: PHEntry): string {
  if (typeof entry.title === "string") return entry.title;
  if (entry.title?.["#text"]) return entry.title["#text"];
  return "(untitled)";
}

function extractLink(entry: PHEntry): string {
  if (!entry.link) return "";
  if (Array.isArray(entry.link)) {
    const alt = entry.link.find((l) => l["@_rel"] === "alternate");
    return alt?.["@_href"] ?? entry.link[0]?.["@_href"] ?? "";
  }
  return entry.link["@_href"] ?? "";
}

function extractContent(entry: PHEntry): { tagline: string; productLink: string } {
  let raw = "";
  if (typeof entry.content === "string") raw = entry.content;
  else if (entry.content?.["#text"]) raw = entry.content["#text"];

  if (!raw) return { tagline: "", productLink: "" };

  // The content has HTML structure:
  // <p>Tagline text</p>
  // <p><a href="...">Discussion</a> | <a href="...product link...">Link</a></p>
  // Extract just the first paragraph as the tagline
  const firstParagraph = raw.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  let tagline = "";
  if (firstParagraph) {
    tagline = stripHtml(firstParagraph[1], { whitespace: "collapse-all" });
  } else {
    // Fallback: strip everything but remove "Discussion | Link" noise
    tagline = stripHtml(raw, { whitespace: "collapse-all" })
      .replace(/Discussion\s*\|\s*Link/gi, "")
      .trim();
  }

  // Extract the product link (the "Link" anchor)
  const linkMatch = raw.match(
    /href="(https:\/\/www\.producthunt\.com\/r\/[^"]+)"/,
  );
  const productLink = linkMatch ? linkMatch[1] : "";

  return { tagline, productLink };
}

function warnEnrichFailed(url: string, detail: unknown): void {
  console.warn(`producthunt: enrich failed for ${url}: ${errorMessage(detail)}`);
}

function extractId(entry: PHEntry): string {
  // id format: "tag:www.producthunt.com,2005:Post/1143406"
  if (entry.id) {
    const match = entry.id.match(/Post\/(\d+)/);
    if (match) return match[1];
    return entry.id;
  }
  return extractLink(entry);
}

async function enrichProduct(url: string): Promise<EnrichedData | null> {
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: ENRICH_FETCH_TIMEOUT_MS,
      userAgent: PH_ENRICH_USER_AGENT,
      accept: "text/html",
    });
    if (!res.ok) {
      warnEnrichFailed(url, { message: String(res.status) });
      return null;
    }
    const html = await res.text();

    const data: EnrichedData = {};

    // Extract upvote count - look for patterns like "Upvote • 215 points" or just numbers near upvote text
    const upvoteMatch = html.match(
      /(\d+)\s*(?:points|upvotes?)/i,
    );
    if (upvoteMatch) {
      data.upvotes = parseInt(upvoteMatch[1], 10);
    }

    // Extract topics/categories from the page
    const topicMatches = html.match(
      /data-test="topic[^"]*"[^>]*>([^<]+)</g,
    );
    if (topicMatches) {
      data.topics = topicMatches.map((m) => {
        const textMatch = m.match(/>([^<]+)$/);
        return textMatch ? textMatch[1].trim() : "";
      }).filter(Boolean);
    }

    // Alternative topic extraction from links like /topics/artificial-intelligence
    if (!data.topics || data.topics.length === 0) {
      const topicLinks = html.match(
        /href="\/topics\/([^"]+)"/g,
      );
      if (topicLinks) {
        data.topics = [...new Set(topicLinks.map((m) => {
          const href = m.match(/\/topics\/([^"]+)/);
          return href
            ? href[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
            : "";
        }).filter(Boolean))];
      }
    }

    // Extract comment count from embedded JSON (commentsCount":68)
    const commentJsonMatch = html.match(
      /commentsCount":\s*(\d+)/,
    );
    if (commentJsonMatch) {
      data.comments = parseInt(commentJsonMatch[1], 10);
    }

    // Extract makers from profile links like href="/@username"
    const profileLinkMatches = html.match(
      /href="\/@([a-zA-Z0-9_]{2,30})"/g,
    );
    if (profileLinkMatches) {
      const EXCLUDED_HANDLES = new Set([
        "producthunt", "product_hunt",
      ]);
      const handles = [...new Set(
        profileLinkMatches.map((m) => {
          const match = m.match(/\/@([a-zA-Z0-9_]{2,30})/);
          return match ? match[1] : "";
        }).filter((h) => h && !EXCLUDED_HANDLES.has(h.toLowerCase())),
      )].slice(0, 3);
      if (handles.length > 0) {
        data.makers = handles.map((h) => `@${h}`);
      }
    }

    return data;
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
  const parts: string[] = [];

  if (tagline) parts.push(tagline);
  if (enriched?.upvotes !== undefined) parts.push(`${enriched.upvotes} upvotes`);
  if (enriched?.comments !== undefined)
    parts.push(`${enriched.comments} comments`);
  if (enriched?.topics && enriched.topics.length > 0) {
    parts.push(`topics: ${enriched.topics.join(", ")}`);
  }
  if (enriched?.makers && enriched.makers.length > 0) {
    parts.push(`by ${enriched.makers.join(", ")}`);
  } else if (author) {
    parts.push(`by ${author}`);
  }
  if (productLink) {
    parts.push(`site: ${productLink}`);
  }

  return parts.join(" | ");
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
  try {
    const res = await fetchWithTimeout(PH_FEED_URL, {
      userAgent: "pace:feed-aggregator/1.0",
      accept: "application/atom+xml, application/xml, text/xml",
    });

    if (!res.ok) {
      throw new Error(`producthunt: failed to fetch feed: ${errorMessage({ message: String(res.status) })}`);
    }

    const xml = await res.text();
    const parsed = parser.parse(xml) as PHAtomFeedParsed;
    const entries = extractEntries(parsed);

    if (entries.length === 0) {
      console.warn("producthunt: no entries found in feed");
      return [];
    }

    // Parse basic data from feed
    return entries.map((entry) => {
      const title = extractTitle(entry);
      const url = extractLink(entry);
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
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("producthunt: failed to fetch")) {
      throw err;
    }
    throw new Error(`producthunt: error fetching feed: ${errorMessage(err)}`);
  }
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
