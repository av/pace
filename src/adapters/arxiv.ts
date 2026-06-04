import { XMLParser } from "fast-xml-parser";
import {
  extractFeedEntryTitle,
  extractFeedItemBody,
  FEED_XML_PARSER_OPTIONS,
  normalizeXmlList,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { formatCategories, joinBodyParts } from "./engagement";
import { ARXIV_FETCH_TIMEOUT_MS, fetchText } from "./fetch";
import {
  decodeNumericFeedTitle,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";
import {
  clampAdapterLimit,
  normalizeOptionalString,
  normalizeStringList,
  sleep,
  sliceToLimit,
} from "../utils";
import { dedupeByKey } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
const ARXIV_API = "http://export.arxiv.org/api/query";
const RATE_LIMIT_DELAY = 3000; // ArXiv requests 3-second delay between requests

const parser = new XMLParser(FEED_XML_PARSER_OPTIONS);

interface ArxivAuthor {
  name?: string;
}

interface ArxivCategory {
  "@_term"?: string;
}

interface ArxivLink {
  "@_href"?: string;
  "@_title"?: string;
  "@_type"?: string;
  "@_rel"?: string;
}

interface ArxivEntry extends FeedItemBodyFields {
  id?: string;
  title?: XmlTextField;
  published?: string;
  updated?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  "arxiv:primary_category"?: ArxivCategory;
  category?: ArxivCategory | ArxivCategory[];
  link?: ArxivLink | ArxivLink[];
}

/** Parsed Atom feed root from fast-xml-parser (attributeNamePrefix "@_"). */
interface ArxivAtomFeedParsed {
  feed?: {
    entry?: ArxivEntry | ArxivEntry[];
  };
}

function extractAuthors(author: ArxivEntry["author"]): string {
  if (!author) return "";
  const authors = Array.isArray(author) ? author : [author];
  return authors
    .map((a) => a.name ?? "")
    .filter(Boolean)
    .join(", ");
}

function extractCategories(entry: ArxivEntry): string[] {
  const cats: string[] = [];
  if (entry["arxiv:primary_category"]?.["@_term"]) {
    cats.push(entry["arxiv:primary_category"]["@_term"]);
  }
  if (entry.category) {
    const categories = Array.isArray(entry.category) ? entry.category : [entry.category];
    for (const cat of categories) {
      const term = cat["@_term"];
      if (term && !cats.includes(term)) {
        cats.push(term);
      }
    }
  }
  return cats;
}

function extractPdfLink(link: ArxivEntry["link"]): string {
  if (!link) return "";
  const links = Array.isArray(link) ? link : [link];
  const pdf = links.find((l) => l["@_title"] === "pdf" || l["@_type"] === "application/pdf");
  if (pdf?.["@_href"]) return pdf["@_href"];
  return "";
}

function extractArxivId(idUrl: string | undefined): string {
  if (!idUrl) return "";
  const match = idUrl.match(/abs\/(.+?)(?:v\d+)?$/);
  return match ? match[1] : idUrl;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

async function fetchArxivQuery(
  queryStr: string,
  limit: number,
): Promise<ArxivEntry[]> {
  const url = `${ARXIV_API}?search_query=${encodeURIComponent(queryStr)}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;
  const context = `query "${queryStr}"`;
  const xml = await fetchText("arxiv", url, context, {
    timeoutMs: ARXIV_FETCH_TIMEOUT_MS,
  });

  const parsed = parser.parse(xml) as ArxivAtomFeedParsed;
  return normalizeXmlList(parsed.feed?.entry);
}

function buildBody(entry: ArxivEntry): string {
  const authors = extractAuthors(entry.author);
  const categories = extractCategories(entry);
  const rawAbstract = extractFeedItemBody(entry);
  const abstract = rawAbstract
    ? decodeNumericFeedTitle(stripHtml(rawAbstract, FEED_BODY_STRIP_OPTIONS))
    : "";
  const pdfLink = extractPdfLink(entry.link);
  const arxivId = extractArxivId(entry.id);
  const pdfUrl = pdfLink || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : "");

  return joinBodyParts(
    authors ? `Authors: ${authors}` : undefined,
    categories.length > 0 ? formatCategories(categories) : undefined,
    abstract ? `Abstract: ${truncate(abstract, 300)}` : undefined,
    pdfUrl ? `PDF: ${pdfUrl}` : undefined,
  );
}

function entryToItem(entry: ArxivEntry, sourceLabel: string): ContentItem {
  const arxivId = extractArxivId(entry.id);
  const title = decodeNumericFeedTitle(
    stripHtml(extractFeedEntryTitle(entry.title), FEED_BODY_STRIP_OPTIONS),
  );
  const url = entry.id ?? `https://arxiv.org/abs/${arxivId}`;
  const timestamp = parseFeedDate(entry.published ?? entry.updated ?? "");

  return {
    id: `arxiv:${arxivId}`,
    title,
    url,
    source: sourceLabel,
    timestamp,
    body: buildBody(entry),
  };
}

const adapter: Adapter = {
  name: "arxiv",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const categories = normalizeStringList(
      (config.params?.categories as string[]) ?? [],
    );
    const query = normalizeOptionalString(
      config.params?.query as string | undefined,
    );
    const limit = clampAdapterLimit(config.params?.limit, 20, 100);

    if (categories.length === 0 && !query) {
      console.warn("arxiv: no categories or query configured");
      return [];
    }

    const allItems: ContentItem[] = [];

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const queryStr = `cat:${cat}`;

      if (i > 0) {
        await sleep(RATE_LIMIT_DELAY);
      }

      const entries = await fetchArxivQuery(queryStr, limit);
      const sourceLabel = `arxiv:${cat}`;

      for (const entry of entries) {
        allItems.push(entryToItem(entry, sourceLabel));
      }
    }

    if (query) {
      if (categories.length > 0) {
        await sleep(RATE_LIMIT_DELAY);
      }

      const queryStr = `all:${query}`;
      const entries = await fetchArxivQuery(queryStr, limit);

      for (const entry of entries) {
        allItems.push(entryToItem(entry, "arxiv:search"));
      }
    }

    const deduped = dedupeByKey(allItems, (item) => item.id);

    deduped.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const totalLimit = categories.length > 1 || (categories.length > 0 && query)
      ? limit * (categories.length + (query ? 1 : 0))
      : limit;

    return sliceToLimit(deduped, totalLimit);
  },
};

export default adapter;
