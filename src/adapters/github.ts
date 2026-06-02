import { XMLParser } from "fast-xml-parser";
import { extractAtomLink, type AtomLinkField } from "./atom";
import { parseFeedDate, sliceToLimit } from "./dates";
import { fetchWithTimeout } from "./fetch";
import { dedupeByKey } from "./merge";
import { stripHtml } from "./html";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

type TrendingPeriod = "daily" | "weekly" | "monthly";

const VALID_PERIODS = new Set<TrendingPeriod>(["daily", "weekly", "monthly"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/** Parsed text node from fast-xml-parser. */
type XmlTextField = string | { "#text"?: string };

interface GHAtomEntry {
  id?: string;
  title?: XmlTextField;
  link?: AtomLinkField;
  updated?: string;
  published?: string;
  content?: XmlTextField;
}

/** Parsed Atom feed root from fast-xml-parser (attributeNamePrefix "@_"). */
interface GHAtomFeedParsed {
  feed?: {
    entry?: GHAtomEntry | GHAtomEntry[];
  };
}

function extractTextContent(val: XmlTextField | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val["#text"] ?? "";
}

function extractEntries(parsed: GHAtomFeedParsed): GHAtomEntry[] {
  const entries = parsed?.feed?.entry;
  if (!entries) return [];
  return Array.isArray(entries) ? entries : [entries];
}

async function fetchGithubResource(
  url: string,
  context: string,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: opts.timeoutMs,
      accept: opts.accept,
    });

    if (!res.ok) {
      throw new Error(`github: failed to fetch ${context}: ${errorMessage({ message: `${res.status}` })}`);
    }

    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("github: failed to fetch")) {
      throw err;
    }
    throw new Error(`github: error fetching ${context}: ${errorMessage(err)}`);
  }
}

async function fetchReleasesFeed(repo: string, limit: number): Promise<ContentItem[]> {
  const url = `https://github.com/${repo}/releases.atom`;

  const xml = await fetchGithubResource(url, `releases for ${repo}`, { timeoutMs: 15000 });
  if (!xml) return [];

  const parsed = parser.parse(xml) as GHAtomFeedParsed;
  const entries = extractEntries(parsed);

  const items: ContentItem[] = [];

  for (const entry of sliceToLimit(entries, limit)) {
    const title = extractTextContent(entry.title) || "(untitled release)";
    const link = extractAtomLink(entry.link);
    const timestamp = parseFeedDate(entry.updated ?? entry.published ?? "");

    const tagMatch = link.match(/\/releases\/tag\/(.+)$/);
    const tag = tagMatch ? tagMatch[1] : "";

    const rawContent = extractTextContent(entry.content);
    const body = rawContent ? stripHtml(rawContent).slice(0, 500) : undefined;

    const displayTitle = tag && title !== tag
      ? `${repo}: ${tag} — ${title}`
      : tag
        ? `${repo}: ${tag}`
        : `${repo}: ${title}`;

    items.push({
      id: `github:${repo}:${tag || title}`,
      title: displayTitle,
      url: link || `https://github.com/${repo}/releases`,
      source: `github:${repo}`,
      timestamp,
      body,
    });
  }

  return items;
}

interface TrendingRepo {
  name: string;        // "owner/repo"
  description: string;
  language: string;
  stars: number;
  starsGained: number;
  url: string;
}

function parseTrendingHtml(html: string): TrendingRepo[] {
  const repos: TrendingRepo[] = [];

  const articleRegex = /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let match: RegExpExecArray | null;

  while ((match = articleRegex.exec(html)) !== null) {
    const article = match[1];

    const nameMatch = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"[\s\S]*?<\/h2>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim().replace(/\s+/g, "");

    const descMatch = article.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    const langMatch = article.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/);
    const language = langMatch ? langMatch[1].trim() : "";

    const starsMatch = article.match(/octicon-star[\s\S]*?<\/svg>\s*([\d,]+)/);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ""), 10) : 0;

    const gainedMatch = article.match(/([\d,]+)\s+stars\s+(today|this week|this month)/);
    const starsGained = gainedMatch ? parseInt(gainedMatch[1].replace(/,/g, ""), 10) : 0;

    repos.push({
      name,
      description,
      language,
      stars,
      starsGained,
      url: `https://github.com/${name}`,
    });
  }

  return repos;
}

async function fetchTrending(
  language: string,
  since: TrendingPeriod,
  limit: number,
): Promise<ContentItem[]> {
  const langPath = language ? `/${encodeURIComponent(language)}` : "";
  const url = `https://github.com/trending${langPath}?since=${since}`;

  const html = await fetchGithubResource(url, `trending`, {
    timeoutMs: 20000,
    accept: "text/html",
  });
  if (!html) return [];

  const repos = parseTrendingHtml(html);

  const periodLabel: Record<TrendingPeriod, string> = {
    daily: "today",
    weekly: "this week",
    monthly: "this month",
  };

  return sliceToLimit(repos, limit).map((repo) => {
    const bodyParts: string[] = [];
    if (repo.description) bodyParts.push(repo.description);
    if (repo.language) bodyParts.push(`language: ${repo.language}`);
    bodyParts.push(`${repo.stars.toLocaleString()} stars`);
    if (repo.starsGained > 0) {
      bodyParts.push(`+${repo.starsGained.toLocaleString()} ${periodLabel[since]}`);
    }

    return {
      id: `github:trending:${repo.name}:${since}`,
      title: repo.name,
      url: repo.url,
      source: language ? `github:trending:${language}` : "github:trending",
      timestamp: new Date(), // trending has no specific timestamp
      body: bodyParts.join(" | "),
    };
  });
}

const adapter: Adapter = {
  name: "github",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const mode = (config.params?.mode as string) ?? "releases";
    const limit = Math.min((config.params?.limit as number) ?? 10, 50);

    if (mode === "trending") {
      const language = (config.params?.language as string) ?? "";
      const sinceParam = (config.params?.since as string) ?? "daily";
      const since: TrendingPeriod = VALID_PERIODS.has(sinceParam as TrendingPeriod)
        ? (sinceParam as TrendingPeriod)
        : "daily";

      return fetchTrending(language, since, limit);
    }

    const repos = (config.params?.repos as string[]) ?? [];
    if (repos.length === 0) {
      console.warn("github: no repos configured for releases mode");
      return [];
    }

    const results = await Promise.all(
      repos.map((repo) => fetchReleasesFeed(repo, limit)),
    );

    const deduped = dedupeByKey(results.flat(), (item) => item.url || item.id);
    deduped.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return sliceToLimit(deduped, limit * repos.length);
  },
};

export default adapter;
