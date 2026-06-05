import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  parseFeedXml,
  normalizeXmlList,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { parseFeedDate } from "./dates";
import {
  formatLanguage,
  formatStars,
} from "./engagement";
import { joinTitle, joinTitleWithTagline } from "./title";

import { FEED_FETCH_TIMEOUT_MS, FEED_XML_ACCEPT, fetchText } from "./fetch";
import {
  clampAdapterLimit,
  normalizeParamString,
  sliceToLimit,
} from "../utils";
import { fetchAllParallelDedupe } from "./merge";
import { decodeNumericFeedTitle, FEED_BODY_STRIP_OPTIONS, stripHtml } from "./html";
import { fetchRepoTagline } from "./github-repo-meta";
import {
  formatGitHubReleaseDisplayTitle,
  resolveGitHubRepos,
} from "./github-shared";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

type TrendingPeriod = "daily" | "weekly" | "monthly";

const VALID_PERIODS = new Set<TrendingPeriod>(["daily", "weekly", "monthly"]);

interface GHAtomEntry extends FeedItemBodyFields {
  id?: string;
  title?: XmlTextField;
  link?: AtomLinkField;
  updated?: string;
  published?: string;
}

interface GHAtomFeedParsed {
  feed?: {
    title?: XmlTextField;
    entry?: GHAtomEntry | GHAtomEntry[];
  };
}

async function fetchReleasesFeed(
  repo: string,
  limit: number,
  token?: string,
): Promise<ContentItem[]> {
  const url = `https://github.com/${repo}/releases.atom`;

  const xml = await fetchText("github", url, `releases for ${repo}`, {
    accept: FEED_XML_ACCEPT,
  });

  const parsed = parseFeedXml<GHAtomFeedParsed>(xml, "github", url);
  const feedTitle = extractFeedRootTitle(undefined, parsed.feed?.title);
  const source = feedTitle
    ? `github:${decodeNumericFeedTitle(feedTitle)}`
    : `github:${repo}`;
  const entries = normalizeXmlList(parsed.feed?.entry);
  const tagline = await fetchRepoTagline(repo, "github", token);

  const items: ContentItem[] = [];

  for (const entry of sliceToLimit(entries, limit)) {
    const link = extractAtomLink(entry.link);
    const timestamp = parseFeedDate(entry.updated ?? entry.published ?? "");

    const tagMatch = link.match(/\/releases\/tag\/(.+)$/);
    const tag = tagMatch ? tagMatch[1] : "";

    const rawBody = extractFeedItemBody(entry);
    const body = rawBody
      ? stripHtml(rawBody, FEED_BODY_STRIP_OPTIONS).slice(0, 500)
      : undefined;

    const rawTitle = extractFeedEntryTitle(entry.title, "(untitled release)");
    const displayTitle = formatGitHubReleaseDisplayTitle(
      repo,
      { tag, title: rawTitle },
      tagline,
    );
    const title = decodeNumericFeedTitle(rawTitle);

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
    const nameFromHref = decodeNumericFeedTitle(
      nameMatch[1].trim().replace(/\s+/g, ""),
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
    timeoutMs: FEED_FETCH_TIMEOUT_MS,
    accept: "text/html",
  });

  const repos = parseTrendingHtml(html);
  if (repos.length === 0) {
    console.warn("github: no repos found on trending page");
    return [];
  }

  const periodLabel: Record<TrendingPeriod, string> = {
    daily: "today",
    weekly: "this week",
    monthly: "this month",
  };

  return sliceToLimit(repos, limit).map((repo) => {
    const body = joinTitle(
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
    const mode = normalizeParamString(config.params, "mode", "releases");
    const limit = clampAdapterLimit(config.params?.limit, 10, 50);

    if (mode === "trending") {
      const language = normalizeParamString(config.params, "language", "");
      const sinceParam = normalizeParamString(config.params, "since", "daily");
      const since: TrendingPeriod = VALID_PERIODS.has(sinceParam as TrendingPeriod)
        ? (sinceParam as TrendingPeriod)
        : "daily";

      return fetchTrending(language, since, limit);
    }

    const resolved = resolveGitHubRepos(config.params, "github");
    if (!resolved) return [];

    const deduped = await fetchAllParallelDedupe(
      resolved.repos,
      (repo) => fetchReleasesFeed(repo, limit, resolved.token),
      (item) => item.url || item.id,
    );
    deduped.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return sliceToLimit(deduped, limit * resolved.repos.length);
  },
};

export default adapter;
