import { XMLParser } from "fast-xml-parser";
import { parseFeedDate, sliceToLimit } from "./dates";
import { fetchText } from "./fetch";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const ARXIV_API = "http://export.arxiv.org/api/query";
const RATE_LIMIT_DELAY = 3000; // ArXiv requests 3-second delay between requests

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

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

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  "arxiv:primary_category"?: ArxivCategory;
  category?: ArxivCategory | ArxivCategory[];
  link?: ArxivLink | ArxivLink[];
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
  // ID format: http://arxiv.org/abs/2401.12345v1
  const match = idUrl.match(/abs\/(.+?)(?:v\d+)?$/);
  return match ? match[1] : idUrl;
}

function cleanText(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Add ArXiv entries as ContentItems to the result list, skipping duplicates by stable id.
 * Used by both category and free-text query paths (DRY).
 */
function addUniqueArxivEntries(
  entries: ArxivEntry[],
  sourceLabel: string,
  seenIds: Set<string>,
  allItems: ContentItem[],
): void {
  for (const entry of entries) {
    const item = entryToItem(entry, sourceLabel);
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      allItems.push(item);
    }
  }
}

async function fetchArxivQuery(
  queryStr: string,
  limit: number,
): Promise<ArxivEntry[]> {
  const url = `${ARXIV_API}?search_query=${encodeURIComponent(queryStr)}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;

  const xml = await fetchText("arxiv", url, `query "${queryStr}"`, { timeoutMs: 30_000 });
  const parsed = parser.parse(xml);

  const entries = parsed?.feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

function buildBody(entry: ArxivEntry): string {
  const parts: string[] = [];

  const authors = extractAuthors(entry.author);
  if (authors) parts.push(`Authors: ${authors}`);

  const categories = extractCategories(entry);
  if (categories.length > 0) parts.push(`Categories: ${categories.join(", ")}`);

  const abstract = cleanText(entry.summary);
  if (abstract) parts.push(`Abstract: ${truncate(abstract, 300)}`);

  const pdfLink = extractPdfLink(entry.link);
  const arxivId = extractArxivId(entry.id);
  const pdfUrl = pdfLink || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : "");
  if (pdfUrl) parts.push(`PDF: ${pdfUrl}`);

  return parts.join(" | ");
}

function entryToItem(entry: ArxivEntry, sourceLabel: string): ContentItem {
  const arxivId = extractArxivId(entry.id);
  const title = cleanText(entry.title) || "(untitled)";
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
    const categories = (config.params?.categories as string[]) ?? [];
    const query = (config.params?.query as string) ?? "";
    const limit = Math.min((config.params?.limit as number) ?? 20, 100);

    if (categories.length === 0 && !query) {
      console.warn("arxiv: no categories or query configured");
      return [];
    }

    const allItems: ContentItem[] = [];
    const seenIds = new Set<string>();

    // Fetch by categories
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const queryStr = `cat:${cat}`;

      if (i > 0) {
        // Respect ArXiv's rate limiting between requests
        await sleep(RATE_LIMIT_DELAY);
      }

      const entries = await fetchArxivQuery(queryStr, limit);
      const sourceLabel = `arxiv:${cat}`;

      addUniqueArxivEntries(entries, sourceLabel, seenIds, allItems);
    }

    // Fetch by keyword query
    if (query) {
      if (categories.length > 0) {
        await sleep(RATE_LIMIT_DELAY);
      }

      const queryStr = `all:${query}`;
      const entries = await fetchArxivQuery(queryStr, limit);

      addUniqueArxivEntries(entries, "arxiv:search", seenIds, allItems);
    }

    // Sort by timestamp descending and limit
    allItems.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // If fetching from multiple categories, limit total results
    const totalLimit = categories.length > 1 || (categories.length > 0 && query)
      ? limit * (categories.length + (query ? 1 : 0))
      : limit;

    return sliceToLimit(allItems, totalLimit);
  },
};

export default adapter;
