import {
  normalizeParamString,
  normalizeParamStringList,
  sliceToLimit,
} from "../utils";
import {
  extractAtomLink,
  extractFeedRootTitle,
  type AtomLinkField,
  type FeedItemBodyFields,
  type XmlTextField,
} from "./atom";
import {
  decodeFeedEntryTitle,
  extractFeedEntryStrippedBody,
  FEED_ENTRY_DATE_ATOM_ORDER,
  parseFeedEntryTimestamp,
} from "./feed-entry";
import { fetchAtomFeed, fetchJson, buildGitHubApiHeaders } from "./fetch";
import { fetchRepoTagline } from "./github-repo-meta";
import { decodeNumericFeedTitle } from "./html";
import { warnEmptyConfig } from "./empty-config";
import { fetchAllParallel, finalizeFetchedItems } from "./merge";
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
  const feedTitle = extractFeedRootTitle(undefined, parsed.feed?.title);
  const source = feedTitle
    ? `github:${decodeNumericFeedTitle(feedTitle)}`
    : `github:${repo}`;
  const tagline = await fetchRepoTagline(repo, adapterName, token);

  const items: ContentItem[] = [];

  for (const entry of sliceToLimit(entries, limit)) {
    const link = extractAtomLink(entry.link);
    const timestamp = parseFeedEntryTimestamp(entry, FEED_ENTRY_DATE_ATOM_ORDER);

    const tagMatch = link.match(/\/releases\/tag\/(.+)$/);
    const tag = tagMatch ? tagMatch[1] : "";

    const strippedBody = extractFeedEntryStrippedBody(entry);
    const body = strippedBody ? capText(strippedBody, 500) : undefined;

    const title = decodeFeedEntryTitle(entry.title, "(untitled release)");
    const displayTitle = formatGitHubReleaseDisplayTitle(
      repo,
      { tag, title },
      tagline,
    );

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
  return releases.map((r) => ({
    id: `github:${repo}:${r.id}`,
    title: formatGitHubReleaseDisplayTitle(repo, { title: r.name ?? r.tag_name }, tagline),
    url: r.html_url,
    source: `github:${repo}`,
    timestamp: new Date(r.published_at),
    body: r.body ?? undefined,
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
    return fetchAllParallel(resolved.repos, (repo) =>
      fetchGitHubApiReleases(repo, limit, adapterName, resolved.token),
    );
  }

  const items = await fetchAllParallel(
    resolved.repos,
    (repo) => fetchGitHubAtomReleases(repo, limit, adapterName, resolved.token),
  );
  return finalizeFetchedItems(items, {
    limit: limit * resolved.repos.length,
    dedupeKey: (item) => item.url || item.id,
    sort: (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
  });
}