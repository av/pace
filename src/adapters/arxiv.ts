import {
  extractFeedItemBody,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import {
  formatCategories,
} from "./engagement";
import { mapToContentItemsPerSource } from "./content-item";
import { joinTitle, truncateText } from "./title";

import { warnEmptyConfig } from "./empty-config";
import {
  decodeFeedEntryStrippedTitle,
  FEED_ENTRY_DATE_ATOM_ORDER,
  parseFeedEntryTimestamp,
} from "./feed-entry";
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
} from "../utils";
import { dedupeByKey } from "../dedupe";
import { aggregateBatchedFeeds } from "./merge";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
const ARXIV_API = "http://export.arxiv.org/api/query";
const RATE_LIMIT_DELAY_MS = 3000;

/** Build arxiv source label for a category query. */
export function arxivCategorySourceLabel(category: string): string {
  return `arxiv:${category}`;
}

/** Source label for keyword search queries. */
export function arxivSearchSourceLabel(): string {
  return "arxiv:search";
}

interface ArxivSource {
  queryStr: string;
  sourceLabel: string;
}

interface TaggedArxivEntry {
  entry: ArxivEntry;
  sourceLabel: string;
  timestamp: Date;
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
  const terms: string[] = [];
  const primary = entry["arxiv:primary_category"]?.["@_term"];
  if (primary) terms.push(primary);
  if (entry.category) {
    const categories = Array.isArray(entry.category) ? entry.category : [entry.category];
    for (const cat of categories) {
      const term = cat["@_term"];
      if (term) terms.push(term);
    }
  }
  return dedupeByKey(terms, (term) => term);
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
    abstract
      ? `Abstract: ${truncateText(abstract, 300, { ellipsis: "...", inclusive: false, trim: false })}`
      : undefined,
    pdfUrl ? `PDF: ${pdfUrl}` : undefined,
  );
}

function projectArxivEntry(entry: ArxivEntry) {
  const arxivId = extractArxivId(entry.id);
  return {
    id: `arxiv:${arxivId}`,
    title: decodeFeedEntryStrippedTitle(entry.title),
    url: entry.id ?? `https://arxiv.org/abs/${arxivId}`,
    timestamp: parseFeedEntryTimestamp(entry, FEED_ENTRY_DATE_ATOM_ORDER),
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
      return warnEmptyConfig("arxiv", "no categories or query configured");
    }

    const sources: ArxivSource[] = [
      ...categories.map((cat) => ({
        queryStr: `cat:${cat}`,
        sourceLabel: arxivCategorySourceLabel(cat),
      })),
      ...(query
        ? [{ queryStr: `all:${query}`, sourceLabel: arxivSearchSourceLabel() }]
        : []),
    ];

    const tagged = await aggregateBatchedFeeds(
      sources,
      1,
      async ({ queryStr, sourceLabel }) => {
        const entries = await fetchArxivQuery(queryStr, limit);
        return entries.map((entry) => ({
          entry,
          sourceLabel,
          timestamp: parseFeedEntryTimestamp(entry, FEED_ENTRY_DATE_ATOM_ORDER),
        }));
      },
      {
        perSourceLimit: limit,
        dedupeKey: (item: TaggedArxivEntry) => extractArxivId(item.entry.id),
      },
      RATE_LIMIT_DELAY_MS,
    );

    return mapToContentItemsPerSource(
      tagged,
      (item) => item.sourceLabel,
      (item) => projectArxivEntry(item.entry),
    );
  },
};

export default adapter;
