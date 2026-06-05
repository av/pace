import {
  normalizeParamString,
  normalizeParamStringList,
} from "../utils";
import { buildGitHubApiHeaders, fetchJson } from "./fetch";
import { fetchRepoTagline } from "./github-repo-meta";
import { decodeNumericFeedTitle } from "./html";
import { joinTitleWithTagline } from "./title";
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

/** Shared repos/token parsing for github and github-releases adapters. */
export function resolveGitHubRepos(
  params: Record<string, unknown> | undefined,
  adapterName: string,
): GitHubReposConfig | null {
  const repos = normalizeParamStringList(params, "repos");
  if (repos.length === 0) {
    console.warn(`${adapterName}: no repos configured`);
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