import { buildGitHubApiHeaders, fetchJson } from "./fetch";
import { errorMessage } from "./types";

export interface GitHubRepoMeta {
  description: string;
}

export async function fetchRepoTagline(
  repo: string,
  adapterName: string,
  token?: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${repo}`;

  try {
    const data = await fetchJson<{ description?: string | null }>(
      adapterName,
      url,
      repo,
      { headers: buildGitHubApiHeaders(token) },
    );
    return (data.description ?? "").trim();
  } catch (err) {
    const msg = errorMessage(err);
    console.warn(
      msg.startsWith(`${adapterName}:`)
        ? msg
        : `${adapterName}: error fetching repo meta for ${repo}: ${msg}`,
    );
    return "";
  }
}