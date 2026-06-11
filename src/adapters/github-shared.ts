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
import { mapToContentItemsPerSource, type ContentItemProjection } from "./content-item";
import {
  decodeFeedEntryTitle,
  extractFeedEntryStrippedBody,
  FEED_ENTRY_DATE_ATOM_ORDER,
  parseFeedEntryTimestamp,
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

interface TaggedGHAtomEntry {
  entry: GHAtomEntry;
  repo: string;
  source: string;
  tagline: string;
  timestamp: Date;
}

interface TaggedGHApiRelease {
  release: GitHubRelease;
  repo: string;
  tagline: string;
  timestamp: Date;
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

function githubAtomDedupeKey(item: TaggedGHAtomEntry): string {
  const link = extractAtomLink(item.entry.link);
  return link || `https://github.com/${item.repo}/releases`;
}

function githubApiDedupeKey(item: TaggedGHApiRelease): string {
  return item.release.html_url || `github:${item.repo}:${item.release.id}`;
}

function projectGitHubAtomEntry(item: TaggedGHAtomEntry): ContentItemProjection {
  const { entry, repo, tagline } = item;
  const title = decodeFeedEntryTitle(entry.title, "(untitled release)");
  const link = extractAtomLink(entry.link);
  const tagMatch = link.match(/\/releases\/tag\/(.+)$/);
  const tag = tagMatch ? tagMatch[1] : "";
  const strippedBody = extractFeedEntryStrippedBody(entry);
  const body = strippedBody ? capText(strippedBody, 500) : undefined;
  return {
    id: `github:${repo}:${tag || title}`,
    title: formatGitHubReleaseDisplayTitle(repo, { tag, title }, tagline),
    url: link || `https://github.com/${repo}/releases`,
    timestamp: item.timestamp,
    body,
  };
}

function projectGitHubApiRelease(item: TaggedGHApiRelease): ContentItemProjection {
  const { release, repo, tagline } = item;
  return {
    id: `github:${repo}:${release.id}`,
    title: formatGitHubReleaseDisplayTitle(
      repo,
      { title: release.name ?? release.tag_name },
      tagline,
    ),
    url: release.html_url,
    timestamp: item.timestamp,
    body: release.body ?? undefined,
  };
}

export async function fetchGitHubAtomReleases(
  repo: string,
  limit: number,
  adapterName: string,
  token?: string,
): Promise<ContentItem[]> {
  const tagged = await fetchGitHubAtomReleasesRaw(repo, limit, adapterName, token);
  return mapToContentItemsPerSource(
    tagged,
    (item) => item.source,
    projectGitHubAtomEntry,
  );
}

async function fetchGitHubAtomReleasesRaw(
  repo: string,
  limit: number,
  adapterName: string,
  token?: string,
): Promise<TaggedGHAtomEntry[]> {
  const url = `https://github.com/${repo}/releases.atom`;

  const { parsed, entries } = await fetchAtomFeed<GHAtomEntry, GHAtomFeedParsed>(
    adapterName,
    url,
    `releases for ${repo}`,
  );
  const feedTitle = resolveDecodedFeedRootTitle(undefined, parsed.feed?.title);
  const source = githubAtomFeedSourceLabel(repo, feedTitle);
  const tagline = await fetchRepoTagline(repo, adapterName, token);

  return sliceAndMap(entries, limit, (entry) => ({
    entry,
    repo,
    source,
    tagline,
    timestamp: parseFeedEntryTimestamp(entry, FEED_ENTRY_DATE_ATOM_ORDER),
  }));
}

export async function fetchGitHubApiReleases(
  repo: string,
  perPage: number,
  adapterName: string,
  token?: string,
): Promise<ContentItem[]> {
  const tagged = await fetchGitHubApiReleasesRaw(repo, perPage, adapterName, token);
  return mapToContentItemsPerSource(
    tagged,
    (item) => githubRepoSourceLabel(item.repo),
    projectGitHubApiRelease,
  );
}

async function fetchGitHubApiReleasesRaw(
  repo: string,
  perPage: number,
  adapterName: string,
  token?: string,
): Promise<TaggedGHApiRelease[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`;
  const releases = await fetchJson<GitHubRelease[]>(adapterName, url, repo, {
    headers: buildGitHubApiHeaders(token),
  });
  const tagline = await fetchRepoTagline(repo, adapterName, token);
  return releases.map((release) => ({
    release,
    repo,
    tagline,
    timestamp: new Date(release.published_at),
  }));
}

/** Fetch releases for multiple repos via atom feed or GitHub API. */
export async function fetchGitHubReposReleases(
  resolved: GitHubReposConfig,
  source: GitHubReleasesSource,
  limit: number,
  adapterName: string,
): Promise<ContentItem[]> {
  if (source === "api") {
    const tagged = await aggregateParallelFeeds(
      resolved.repos,
      (repo) => fetchGitHubApiReleasesRaw(repo, limit, adapterName, resolved.token),
      {
        perSourceLimit: limit,
        dedupeKey: githubApiDedupeKey,
      },
    );
    return mapToContentItemsPerSource(
      tagged,
      (item) => githubRepoSourceLabel(item.repo),
      projectGitHubApiRelease,
    );
  }

  const tagged = await aggregateParallelFeeds(
    resolved.repos,
    (repo) => fetchGitHubAtomReleasesRaw(repo, limit, adapterName, resolved.token),
    {
      perSourceLimit: limit,
      dedupeKey: githubAtomDedupeKey,
    },
  );
  return mapToContentItemsPerSource(
    tagged,
    (item) => item.source,
    projectGitHubAtomEntry,
  );
}