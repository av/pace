import type { AdapterType } from "./params";
import { ADAPTER_TYPES } from "./params";
import type { Adapter } from "./types";
import arxivAdapter from "./arxiv";
import devtoAdapter from "./devto";
import githubAdapter from "./github";
import { githubReleasesAdapter } from "./github-shared";
import hackernewsAdapter from "./hackernews";
import lemmyAdapter from "./lemmy";
import lobstersAdapter from "./lobsters";
import mastodonAdapter from "./mastodon";
import npmAdapter from "./npm";
import podcastAdapter from "./podcast";
import producthuntAdapter from "./producthunt";
import redditAdapter from "./reddit";
import rssAdapter from "./rss";
import stackexchangeAdapter from "./stackexchange";
import twitterAdapter from "./twitter";
import wikipediaAdapter from "./wikipedia";
import youtubeAdapter from "./youtube";

/** Canonical built-in adapter modules keyed by ADAPTER_TYPES (positive registry). */
export const BUILTIN_ADAPTER_MODULES: Readonly<Record<AdapterType, Adapter>> = {
  arxiv: arxivAdapter,
  devto: devtoAdapter,
  github: githubAdapter,
  "github-releases": githubReleasesAdapter,
  hackernews: hackernewsAdapter,
  lemmy: lemmyAdapter,
  lobsters: lobstersAdapter,
  mastodon: mastodonAdapter,
  npm: npmAdapter,
  podcast: podcastAdapter,
  producthunt: producthuntAdapter,
  reddit: redditAdapter,
  rss: rssAdapter,
  stackexchange: stackexchangeAdapter,
  twitter: twitterAdapter,
  wikipedia: wikipediaAdapter,
  youtube: youtubeAdapter,
};

export function loadBuiltinAdapters(): Map<string, Adapter> {
  const adapters = new Map<string, Adapter>();
  for (const type of ADAPTER_TYPES) {
    adapters.set(type, BUILTIN_ADAPTER_MODULES[type]);
  }
  return adapters;
}