import { XMLParser } from "fast-xml-parser";
import { extractAtomLink } from "./atom";
import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

type Mode = "releases" | "trending";
type TrendingPeriod = "daily" | "weekly" | "monthly";

const VALID_PERIODS = new Set<TrendingPeriod>(["daily", "weekly", "monthly"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// --- Releases mode ---
// Uses GitHub's public Atom feeds: https://github.com/{owner}/{repo}/releases.atom

interface AtomEntry {
  id?: string;
  title?: string | { "#text": string };
  link?: { "@_href"?: string } | Array<{ "@_href"?: string; "@_rel"?: string }>;
  updated?: string;
  published?: string;
  content?: string | { "#text": string };
}

function extractTextContent(val: string | { "#text": string } | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val["#text"] ?? "";
}

function stripHtml(html: string): string {
  // Simple HTML tag stripping for release notes
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Shared fetch helper for GitHub resources (Atom releases feeds and trending HTML pages).
 * Centralizes User-Agent, timeout, optional Accept header, !ok handling and error logging
 * so the two call sites no longer duplicate the boilerplate.
 * `context` is interpolated into the exact original warn strings for full behavior match.
 */
async function fetchGithubResource(
  url: string,
  context: string,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const headers: Record<string, string> = { "User-Agent": "pace/1.0" };
  if (opts.accept) {
    headers.Accept = opts.accept;
  }

  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`github: failed to fetch ${context}: ${errorMessage({ message: `${res.status}` })}`);
    }

    return await res.text();
  } catch (err) {
    throw new Error(`github: error fetching ${context}: ${errorMessage(err)}`);
  }
}

async function fetchReleasesFeed(repo: string, limit: number): Promise<ContentItem[]> {
  const url = `https://github.com/${repo}/releases.atom`;

  const xml = await fetchGithubResource(url, `releases for ${repo}`, { timeoutMs: 15000 });
  if (!xml) return [];

  const parsed = parser.parse(xml);

  const entries: AtomEntry[] = (() => {
    const e = parsed?.feed?.entry;
    if (!e) return [];
    return Array.isArray(e) ? e : [e];
  })();

  const items: ContentItem[] = [];

  for (const entry of entries.slice(0, limit)) {
    const title = extractTextContent(entry.title) || "(untitled release)";
    const link = extractAtomLink(entry.link);
    const dateStr = entry.updated ?? entry.published ?? "";
    const timestamp = dateStr ? new Date(dateStr) : new Date();

    // Extract version tag from the link URL (e.g., /facebook/react/releases/tag/v19.0.0)
    const tagMatch = link.match(/\/releases\/tag\/(.+)$/);
    const tag = tagMatch ? tagMatch[1] : "";

    // Content is the release body (HTML)
    const rawContent = extractTextContent(entry.content);
    const body = rawContent ? stripHtml(rawContent).slice(0, 500) : undefined;

    // Build display title: "repo: tag — title" or just "repo: title"
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
      timestamp: isNaN(timestamp.getTime()) ? new Date() : timestamp,
      body,
    });
  }

  return items;
}

// --- Trending mode ---
// Scrapes https://github.com/trending/{language}?since={period}

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

  // Each trending repo is in an <article class="Box-row">
  const articleRegex = /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let match: RegExpExecArray | null;

  while ((match = articleRegex.exec(html)) !== null) {
    const article = match[1];

    // Extract repo name from h2 > a href="/owner/repo"
    const nameMatch = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"[\s\S]*?<\/h2>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim().replace(/\s+/g, "");

    // Extract description from <p class="...">
    const descMatch = article.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";

    // Extract language from span with itemprop="programmingLanguage"
    const langMatch = article.match(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)<\/span>/);
    const language = langMatch ? langMatch[1].trim() : "";

    // Extract total stars — look for SVG with octicon-star followed by number
    const starsMatch = article.match(/octicon-star[\s\S]*?<\/svg>\s*([\d,]+)/);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ""), 10) : 0;

    // Extract stars gained in period — "N stars today/this week/this month"
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

  return repos.slice(0, limit).map((repo) => {
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

// --- Unified adapter ---

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

    // Default: releases mode
    const repos = (config.params?.repos as string[]) ?? [];
    if (repos.length === 0) {
      console.warn("github: no repos configured for releases mode");
      return [];
    }

    const results = await Promise.all(
      repos.map((repo) => fetchReleasesFeed(repo, limit)),
    );

    // Flatten and sort by timestamp descending
    const allItems = results.flat();
    allItems.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return allItems.slice(0, limit * repos.length);
  },
};

export default adapter;
