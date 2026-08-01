import {
  formatLanguage,
  formatStars,
} from "./engagement";
import { joinTitle, joinTitleWithTagline } from "./title";

import { warnEmptyFetchResult } from "./empty-config";
import { FEED_FETCH_TIMEOUT_MS, fetchText } from "./fetch";
import {
  clampAdapterLimit,
  normalizeParamString,
  createAliasedResolver,
} from "../utils";
import { decodeNumericFeedTitle, FEED_BODY_STRIP_OPTIONS, stripHtml } from "./html";
import { sliceMapToContentItems } from "./content-item";
import {
  fetchGitHubReposReleases,
  githubTrendingSourceLabel,
  resolveGitHubRepos,
} from "./github-shared";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

type TrendingPeriod = "daily" | "weekly" | "monthly";
type GitHubMode = "trending" | "releases";

const DEFAULT_PERIOD: TrendingPeriod = "daily";
const DEFAULT_MODE: GitHubMode = "releases";

/** Map configured mode param (canonical name or alias) to github adapter mode. Unknown → releases. */
export const resolveGitHubMode = createAliasedResolver<GitHubMode>({
  types: ["trending", "releases"],
  aliases: {
    release: "releases",
  },
  fallback: DEFAULT_MODE,
});

/** Map configured since param (canonical name or alias) to GitHub trending period. Unknown → daily. */
export const resolveGitHubPeriod = createAliasedResolver<TrendingPeriod>({
  types: ["daily", "weekly", "monthly"],
  aliases: {
    day: "daily",
    today: "daily",
    "1d": "daily",
    "24h": "daily",
    week: "weekly",
    "7d": "weekly",
    month: "monthly",
    "30d": "monthly",
  },
  fallback: DEFAULT_PERIOD,
});

interface TrendingRepo {
  name: string;
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

    // "stars?" — a repo that gained exactly one star renders "1 star today".
    const gainedMatch = article.match(/([\d,]+)\s+stars?\s+(today|this week|this month)/);
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
    warnEmptyFetchResult("github", "repos", "trending page");
    return [];
  }

  const periodLabel: Record<TrendingPeriod, string> = {
    daily: "today",
    weekly: "this week",
    monthly: "this month",
  };

  return sliceMapToContentItems(
    repos,
    limit,
    githubTrendingSourceLabel(language),
    (repo) => {
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
        timestamp: new Date(),
        body: body || undefined,
      };
    },
  );
}

type GitHubModeFetcher = (
  config: AdapterConfig,
  limit: number,
) => Promise<ContentItem[]>;

const GITHUB_MODE_PIPELINES = {
  trending: async (config, limit) => {
    const language = normalizeParamString(config.params, "language", "");
    const since = resolveGitHubPeriod(
      normalizeParamString(config.params, "since", "daily"),
    );
    return fetchTrending(language, since, limit);
  },
  releases: async (config, limit) => {
    const resolved = resolveGitHubRepos(config.params, "github");
    if (!resolved) return [];
    return fetchGitHubReposReleases(resolved, "atom", limit, "github");
  },
} satisfies Record<GitHubMode, GitHubModeFetcher>;

const adapter: Adapter = {
  name: "github",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const mode = resolveGitHubMode(
      normalizeParamString(config.params, "mode", DEFAULT_MODE),
    );
    const limit = clampAdapterLimit(config.params?.limit, 10, 50);
    return GITHUB_MODE_PIPELINES[mode](config, limit);
  },
};

export default adapter;