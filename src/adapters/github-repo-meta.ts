import { fetchJson } from "./fetch";
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
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const data = await fetchJson<{ description?: string | null }>(
      adapterName,
      url,
      repo,
      { headers },
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