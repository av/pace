import { clampAdapterLimit } from "../utils";
import { fetchAllParallel } from "./merge";
import {
  fetchGitHubApiReleases,
  resolveGitHubRepos,
} from "./github-shared";
import type { Adapter, AdapterConfig } from "./types";

const ADAPTER_NAME = "github-releases";
const DEFAULT_RELEASES_PER_PAGE = 5;
const MAX_RELEASES_PER_PAGE = 30;

const adapter: Adapter = {
  name: ADAPTER_NAME,
  async fetch(config: AdapterConfig) {
    const resolved = resolveGitHubRepos(config.params, ADAPTER_NAME);
    if (!resolved) return [];

    const perPage = clampAdapterLimit(
      config.params?.limit,
      DEFAULT_RELEASES_PER_PAGE,
      MAX_RELEASES_PER_PAGE,
    );

    return fetchAllParallel(resolved.repos, (repo) =>
      fetchGitHubApiReleases(repo, perPage, ADAPTER_NAME, resolved.token),
    );
  },
};

export default adapter;