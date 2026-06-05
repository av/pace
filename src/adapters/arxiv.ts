import {
  extractFeedEntryTitle,
  extractFeedItemBody,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import {
  formatCategories,
} from "./engagement";
import { joinTitle } from "./title";

import { ARXIV_FETCH_TIMEOUT_MS, fetchAtomFeed } from "./fetch";
import {
  decodeNumericFeedTitle,
  FEED_BODY_STRIP_OPTIONS,
  stripHtml,
} from "./html";
import {
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  sliceToLimit,
} from "../utils";
import { dedupeByKey, fetchAllBatched } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
const ARXIV_API = "http://export.arxiv.org/api/query";
const RATE_LIMIT_DELAY_MS = 3000;

interface ArxivSource {
  queryStr: string;
  sourceLabel: string;
}

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
  const { entries } = await fetchAtomFeed<ArxivEntry, ArxivAtomFeedParsed>(
    "arxiv",
    url,
    context,
    { timeoutMs: ARXIV_FETCH_TIMEOUT_MS },
  );
  return entries;
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

  return joinTitle(
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
    const categories = normalizeParamStringList(config.params, "categories");
    const query = normalizeParamString(config.params, "query");
    const limit = clampAdapterLimit(config.params?.limit, 20, 100);

    if (categories.length === 0 && !query) {
      console.warn("arxiv: no categories or query configured");
      return [];
    }

    const sources: ArxivSource[] = [
      ...categories.map((cat) => ({
        queryStr: `cat:${cat}`,
        sourceLabel: `arxiv:${cat}`,
      })),
      ...(query
        ? [{ queryStr: `all:${query}`, sourceLabel: "arxiv:search" }]
        : []),
    ];

    const allItems = (
      await fetchAllBatched(
        sources,
        1,
        async ({ queryStr, sourceLabel }) => {
          const entries = await fetchArxivQuery(queryStr, limit);
          return entries.map((entry) => entryToItem(entry, sourceLabel));
        },
        RATE_LIMIT_DELAY_MS,
      )
    ).flat();

    const deduped = dedupeByKey(allItems, (item) => item.id);

    deduped.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const totalLimit = categories.length > 1 || (categories.length > 0 && query)
      ? limit * (categories.length + (query ? 1 : 0))
      : limit;

    return sliceToLimit(deduped, totalLimit);
  },
};

export default adapter;
