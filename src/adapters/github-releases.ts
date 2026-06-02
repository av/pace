import { fetchWithTimeout } from "./fetch";
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

const ADAPTER_NAME = "github-releases";
const RELEASES_PER_PAGE = 5;

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

  try {
    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) {
      throw new Error(`${ADAPTER_NAME}: failed to fetch ${repo}: ${errorMessage({ message: String(res.status) })}`);
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
    throw new Error(`${ADAPTER_NAME}: error fetching ${repo}: ${errorMessage(err)}`);
  }
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
