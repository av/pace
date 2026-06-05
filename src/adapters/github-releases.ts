import { clampAdapterLimit } from "../utils";
import {
  fetchGitHubReposReleases,
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

    return fetchGitHubReposReleases(resolved, "api", perPage, ADAPTER_NAME);
  },
};

export default adapter;