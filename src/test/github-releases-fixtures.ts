import type { GitHubRelease } from "../adapters/github-shared";
import { makeJsonResponse } from "./fetch-responses";

export function makeGitHubRelease(
  overrides: Partial<GitHubRelease> = {},
): GitHubRelease {
  return {
    id: 1,
    tag_name: "v1.0.0",
    name: "One",
    html_url: "https://github.com/o/r/releases/tag/v1.0.0",
    body: null,
    published_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeGitHubRepoMeta(description: string | null = null) {
  return { description };
}

export interface GitHubReleasesFetchMockOptions {
  repo?: string;
  releases?: GitHubRelease[];
  description?: string | null;
}

export async function githubReleasesApiFetchMock(
  input: RequestInfo | URL,
  options: GitHubReleasesFetchMockOptions = {},
): Promise<Response> {
  const repo = options.repo ?? "o/r";
  const releases = options.releases ?? [];
  const description = options.description ?? null;
  const url = String(input);
  if (url.includes("/releases?")) {
    return makeJsonResponse(releases);
  }
  if (url.includes(`api.github.com/repos/${repo}`)) {
    return makeJsonResponse(makeGitHubRepoMeta(description));
  }
  throw new Error(`unexpected url: ${url}`);
}