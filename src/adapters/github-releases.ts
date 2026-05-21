import type { Adapter, AdapterConfig, ContentItem } from "./types";
import { errorMessage } from "./types";

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  html_url: string;
  body: string | null;
  published_at: string;
}

async function fetchRepoReleases(
  repo: string,
  token?: string,
): Promise<ContentItem[]> {
  const url = `https://api.github.com/repos/${repo}/releases?per_page=5`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pace/1.0",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      throw new Error(`github-releases: failed to fetch ${repo}: ${res.status}`);
    }
    const releases: GitHubRelease[] = await res.json();
    return releases.map((r) => ({
      id: `github:${repo}:${r.id}`,
      title: r.name ?? r.tag_name,
      url: r.html_url,
      source: `github:${repo}`,
      timestamp: new Date(r.published_at),
      body: r.body ?? undefined,
    }));
  } catch (err) {
    throw new Error(`github-releases: error fetching ${repo}: ${errorMessage(err)}`);
  }
}

const adapter: Adapter = {
  name: "github-releases",
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
