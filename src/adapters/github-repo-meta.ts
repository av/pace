import { normalizeOptionalString } from "../utils";
import { buildGitHubApiHeaders, fetchJson, warnOptionalFetchFailure } from "./fetch";


export async function fetchRepoTagline(
  repo: string,
  adapterName: string,
  token?: string,
): Promise<string> {
  const authToken = normalizeOptionalString(token);
  const url = `https://api.github.com/repos/${repo}`;

  try {
    const data = await fetchJson<{ description?: string | null }>(
      adapterName,
      url,
      repo,
      { headers: buildGitHubApiHeaders(authToken) },
    );
    return (data.description ?? "").trim();
  } catch (err) {
    warnOptionalFetchFailure(
      adapterName,
      err,
      `error fetching repo meta for ${repo}`,
    );
    return "";
  }
}