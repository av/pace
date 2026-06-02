import { XMLParser } from "fast-xml-parser";
import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  FEED_XML_PARSER_OPTIONS,
  normalizeXmlList,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import { formatLanguage, formatStars, joinBodyParts } from "./engagement";
import { fetchText } from "./fetch";
import { sliceToLimit } from "../utils";
import { dedupeByKey } from "./merge";
import { decodeHtmlEntities, FEED_BODY_STRIP_OPTIONS, stripHtml } from "./html";
import { fetchRepoTagline } from "./github-repo-meta";
import { joinTitleWithTagline, titleWithTagline } from "./title";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

type TrendingPeriod = "daily" | "weekly" | "monthly";

const VALID_PERIODS = new Set<TrendingPeriod>(["daily", "weekly", "monthly"]);

const parser = new XMLParser(FEED_XML_PARSER_OPTIONS);

interface GHAtomEntry extends FeedItemBodyFields {
  id?: string;
  title?: XmlTextField;
  link?: AtomLinkField;
  updated?: string;
  published?: string;
}

/** Parsed Atom feed root from fast-xml-parser (attributeNamePrefix "@_"). */
interface GHAtomFeedParsed {
  feed?: {
    title?: XmlTextField;
    entry?: GHAtomEntry | GHAtomEntry[];
  };
}

function releasesFeedSource(parsed: GHAtomFeedParsed, repo: string): string {
  const feedTitle = extractFeedRootTitle(undefined, parsed.feed?.title);
  if (feedTitle) {
    return `github:${decodeHtmlEntities(feedTitle, { numeric: true })}`;
  }
  return `github:${repo}`;
}

async function fetchReleasesFeed(
  repo: string,
  limit: number,
  token?: string,
): Promise<ContentItem[]> {
  const url = `https://github.com/${repo}/releases.atom`;

  const xml = await fetchText("github", url, `releases for ${repo}`, { timeoutMs: 15000 });

  const parsed = parser.parse(xml) as GHAtomFeedParsed;
  const source = releasesFeedSource(parsed, repo);
  const entries = normalizeXmlList(parsed.feed?.entry);
  const tagline = await fetchRepoTagline(repo, "github", token);

  const items: ContentItem[] = [];

  for (const entry of sliceToLimit(entries, limit)) {
    const title = decodeHtmlEntities(
      extractFeedEntryTitle(entry.title, "(untitled release)"),
      { numeric: true },
    );
    const link = extractAtomLink(entry.link);
    const timestamp = parseFeedDate(entry.updated ?? entry.published ?? "");

    const tagMatch = link.match(/\/releases\/tag\/(.+)$/);
    const tag = tagMatch ? tagMatch[1] : "";

    const rawBody = extractFeedItemBody(entry);
    const body = rawBody
      ? stripHtml(rawBody, FEED_BODY_STRIP_OPTIONS).slice(0, 500)
      : undefined;

    const releaseTitle = tag && title !== tag
      ? `${repo}: ${tag} | ${title}`
      : tag
        ? `${repo}: ${tag}`
        : `${repo}: ${title}`;
    const displayTitle = titleWithTagline(releaseTitle, tagline);

    items.push({
      id: `github:${repo}:${tag || title}`,
      title: displayTitle,
      url: link || `https://github.com/${repo}/releases`,
      source,
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

    const nameMatch = article.match(
      /<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/,
    );
    if (!nameMatch) continue;
    const nameFromHref = decodeHtmlEntities(
      nameMatch[1].trim().replace(/\s+/g, ""),
      { numeric: true },
    );
    const nameFromLink = stripHtml(nameMatch[2] ?? "", FEED_BODY_STRIP_OPTIONS)
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, "");
    const name = nameFromLink || nameFromHref;

    const descMatch = article.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch
      ? stripHtml(descMatch[1], FEED_BODY_STRIP_OPTIONS)
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

  const html = await fetchText("github", url, "trending", {
    timeoutMs: 20000,
    accept: "text/html",
  });

  const repos = parseTrendingHtml(html);

  const periodLabel: Record<TrendingPeriod, string> = {
    daily: "today",
    weekly: "this week",
    monthly: "this month",
  };

  return sliceToLimit(repos, limit).map((repo) => {
    const body = joinBodyParts(
      repo.language ? formatLanguage(repo.language) : undefined,
      formatStars(repo.stars),
    );

    return {
      id: `github:trending:${repo.name}:${since}`,
      title: joinTitleWithTagline(
        repo.name,
        repo.description || null,
        100,
        repo.starsGained > 0
          ? `+${repo.starsGained.toLocaleString()} ${periodLabel[since]}`
          : null,
      ),
      url: repo.url,
      source: language ? `github:trending:${language}` : "github:trending",
      timestamp: new Date(), // trending has no specific timestamp
      body: body || undefined,
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

    const token = config.params?.token as string | undefined;
    const results = await Promise.all(
      repos.map((repo) => fetchReleasesFeed(repo, limit, token)),
    );

    const deduped = dedupeByKey(results.flat(), (item) => item.url || item.id);
    deduped.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return sliceToLimit(deduped, limit * repos.length);
  },
};

export default adapter;
