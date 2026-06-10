import {
  normalizeParamString,
  normalizeParamStringList,
} from "../utils";
import {
  extractAtomLink,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import { mapToContentItems } from "./content-item";
import {
  decodeFeedEntryTitle,
  extractFeedEntryStrippedBody,
  FEED_ENTRY_DATE_ATOM_ORDER,
  projectFeedEntryToContentItem,
  resolveDecodedFeedRootTitle,
} from "./feed-entry";
import { fetchAtomFeed, fetchJson, buildGitHubApiHeaders } from "./fetch";
import { fetchRepoTagline } from "./github-repo-meta";
import { decodeNumericFeedTitle } from "./html";
import { warnEmptyConfig } from "./empty-config";
import { aggregateParallelFeeds, sliceAndMap } from "./merge";
import { capText, joinTitleWithTagline } from "./title";
import type { ContentItem } from "./types";

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  body: string | null;
  published_at: string;
}

export interface GitHubReposConfig {
  repos: string[];
  token: string | undefined;
}

export type GitHubReleasesSource = "atom" | "api";

/** Source label for a repo's GitHub API or atom feed (repo slug). */
export function githubRepoSourceLabel(repo: string): string {
  return `github:${repo}`;
}

/** Atom feed source: decoded feed title when present, else repo slug. */
export function githubAtomFeedSourceLabel(
  repo: string,
  feedTitle: string | undefined,
): string {
  return feedTitle ? `github:${feedTitle}` : githubRepoSourceLabel(repo);
}

/** Source label for GitHub trending pages (optional language filter). */
export function githubTrendingSourceLabel(language?: string): string {
  return language ? `github:trending:${language}` : "github:trending";
}

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

/** Shared repos/token parsing for github and github-releases adapters. */
export function resolveGitHubRepos(
  params: Record<string, unknown> | undefined,
  adapterName: string,
): GitHubReposConfig | null {
  const repos = normalizeParamStringList(params, "repos");
  if (repos.length === 0) {
    warnEmptyConfig(adapterName, "no repos configured");
    return null;
  }
  return { repos, token: normalizeParamString(params, "token") };
}

/** Build display title for atom or API release items. */
export function formatGitHubReleaseDisplayTitle(
  repo: string,
  parts: { tag?: string; title: string },
  tagline: string,
): string {
  const decodedTitle = decodeNumericFeedTitle(parts.title);
  const tag = parts.tag;
  const releaseTitle = tag && decodedTitle !== tag
    ? `${repo}: ${tag} | ${decodedTitle}`
    : tag
      ? `${repo}: ${tag}`
      : `${repo}: ${decodedTitle}`;
  return joinTitleWithTagline(releaseTitle, tagline);
}

export async function fetchGitHubAtomReleases(
  repo: string,
  limit: number,
  adapterName: string,
  token?: string,
): Promise<ContentItem[]> {
  const url = `https://github.com/${repo}/releases.atom`;

  const { parsed, entries } = await fetchAtomFeed<GHAtomEntry, GHAtomFeedParsed>(
    adapterName,
    url,
    `releases for ${repo}`,
  );
  const feedTitle = resolveDecodedFeedRootTitle(undefined, parsed.feed?.title);
  const source = githubAtomFeedSourceLabel(repo, feedTitle);
  const tagline = await fetchRepoTagline(repo, adapterName, token);

  return sliceAndMap(entries, limit, (entry) =>
    projectFeedEntryToContentItem(
      "github",
      entry,
      ({ title }) => {
        const link = extractAtomLink(entry.link);
        const tagMatch = link.match(/\/releases\/tag\/(.+)$/);
        const tag = tagMatch ? tagMatch[1] : "";
        const strippedBody = extractFeedEntryStrippedBody(entry);
        const body = strippedBody ? capText(strippedBody, 500) : undefined;
        return {
          idSuffix: `${repo}:${tag || title}`,
          url: link || `https://github.com/${repo}/releases`,
          source,
          body,
          title: formatGitHubReleaseDisplayTitle(repo, { tag, title }, tagline),
        };
      },
      FEED_ENTRY_DATE_ATOM_ORDER,
      (title) => decodeFeedEntryTitle(title, "(untitled release)"),
    ),
  );
}

export async function fetchGitHubApiReleases(
  repo: string,
  perPage: number,
  adapterName: string,
  token?: string,
): Promise<ContentItem[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`;
  const releases = await fetchJson<GitHubRelease[]>(adapterName, url, repo, {
    headers: buildGitHubApiHeaders(token),
  });
  const tagline = await fetchRepoTagline(repo, adapterName, token);
  return mapToContentItems(releases, githubRepoSourceLabel(repo), (release) => ({
    id: `github:${repo}:${release.id}`,
    title: formatGitHubReleaseDisplayTitle(
      repo,
      { title: release.name ?? release.tag_name },
      tagline,
    ),
    url: release.html_url,
    timestamp: new Date(release.published_at),
    body: release.body ?? undefined,
  }));
}

/** Fetch releases for multiple repos via atom feed or GitHub API. */
export async function fetchGitHubReposReleases(
  resolved: GitHubReposConfig,
  source: GitHubReleasesSource,
  limit: number,
  adapterName: string,
): Promise<ContentItem[]> {
  return aggregateParallelFeeds(
    resolved.repos,
    (repo) =>
      source === "api"
        ? fetchGitHubApiReleases(repo, limit, adapterName, resolved.token)
        : fetchGitHubAtomReleases(repo, limit, adapterName, resolved.token),
    {
      perSourceLimit: limit,
      dedupeKey: (item) => item.url || item.id,
    },
  );
}