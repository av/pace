import { normalizeOptionalString } from "../utils";
import {
  buildGitHubApiHeaders,
  fetchJson,
  jsonObjectOrNull,
  tryOptionalFetch,
} from "./fetch";

interface GitHubRepoMeta {
  description?: string | null;
}

export async function fetchRepoTagline(
  repo: string,
  adapterName: string,
  token?: string,
): Promise<string> {
  const authToken = normalizeOptionalString(token);
  const url = `https://api.github.com/repos/${repo}`;

  const raw = await tryOptionalFetch(
    adapterName,
    `error fetching repo meta for ${repo}`,
    () =>
      fetchJson<unknown>(adapterName, url, repo, {
        headers: buildGitHubApiHeaders(authToken),
      }),
  );
  if (raw == null) return "";
  const data = jsonObjectOrNull<GitHubRepoMeta>(adapterName, raw, repo);
  return (data?.description ?? "").trim();
}