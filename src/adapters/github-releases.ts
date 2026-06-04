import {
  clampAdapterLimit,
  normalizeOptionalString,
  normalizeStringList,
} from "../utils";
import { buildGitHubApiHeaders, fetchJson } from "./fetch";
import { fetchRepoTagline } from "./github-repo-meta";
import { decodeNumericFeedTitle } from "./html";
import { joinTitleWithTagline } from "./title";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  body: string | null;
  published_at: string;
}

const ADAPTER_NAME = "github-releases";
const DEFAULT_RELEASES_PER_PAGE = 5;
const MAX_RELEASES_PER_PAGE = 30;

async function fetchRepoReleases(
  repo: string,
  perPage: number,
  token?: string,
): Promise<ContentItem[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=${perPage}`;
  const releases = await fetchJson<GitHubRelease[]>(ADAPTER_NAME, url, repo, {
    headers: buildGitHubApiHeaders(token),
  });
  const tagline = await fetchRepoTagline(repo, ADAPTER_NAME, token);
  return releases.map((r) => {
    const releaseName = decodeNumericFeedTitle(r.name ?? r.tag_name);
    const title = joinTitleWithTagline(`${repo}: ${releaseName}`, tagline);
    return {
      id: `github:${repo}:${r.id}`,
      title,
      url: r.html_url,
      source: `github:${repo}`,
      timestamp: new Date(r.published_at),
      body: r.body ?? undefined,
    };
  });
}

const adapter: Adapter = {
  name: ADAPTER_NAME,
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const repos = normalizeStringList((config.params?.repos as string[]) ?? []);
    const token = normalizeOptionalString(
      config.params?.token as string | undefined,
    );
    if (repos.length === 0) {
      console.warn("github-releases: no repos configured");
      return [];
    }

    const perPage = clampAdapterLimit(
      config.params?.limit,
      DEFAULT_RELEASES_PER_PAGE,
      MAX_RELEASES_PER_PAGE,
    );

    const results = await Promise.all(
      repos.map((repo) => fetchRepoReleases(repo, perPage, token)),
    );
    return results.flat();
  },
};

export default adapter;
