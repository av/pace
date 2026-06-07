import { normalizeOptionalString } from "../utils";
import { buildGitHubApiHeaders, fetchJson, tryOptionalFetch } from "./fetch";


export async function fetchRepoTagline(
  repo: string,
  adapterName: string,
  token?: string,
): Promise<string> {
  const authToken = normalizeOptionalString(token);
  const url = `https://api.github.com/repos/${repo}`;

  const data = await tryOptionalFetch(
    adapterName,
    `error fetching repo meta for ${repo}`,
    () =>
      fetchJson<{ description?: string | null }>(adapterName, url, repo, {
        headers: buildGitHubApiHeaders(authToken),
      }),
  );
  return (data?.description ?? "").trim();
}