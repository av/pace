import { fetchJson } from "./fetch";
import { fetchRepoTagline } from "./github-repo-meta";
import { decodeHtmlEntities } from "./html";
import { titleWithTagline } from "./title";
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
const RELEASES_PER_PAGE = 5;

function decodeReleaseName(name: string): string {
  return decodeHtmlEntities(name, { numeric: true });
}

async function fetchRepoReleases(
  repo: string,
  token?: string,
): Promise<ContentItem[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const releases = await fetchJson<GitHubRelease[]>(ADAPTER_NAME, url, repo, { headers });
  const tagline = await fetchRepoTagline(repo, ADAPTER_NAME, token);
  return releases.map((r) => {
    const releaseName = decodeReleaseName(r.name ?? r.tag_name);
    const title = titleWithTagline(`${repo}: ${releaseName}`, tagline);
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
    const repos = (config.params?.repos as string[]) ?? [];
    const token = config.params?.token as string | undefined;
    if (repos.length === 0) return [];

    const results = await Promise.all(
      repos.map((repo) => fetchRepoReleases(repo, token)),
    );
    return results.flat();
  },
};

export default adapter;
