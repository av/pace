import { describe, expect, test } from "bun:test";
import type { Adapter } from "./types";
import arxivAdapter from "./arxiv";
import devtoAdapter from "./devto";
import githubAdapter from "./github";
import githubReleasesAdapter from "./github-releases";
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

const BUILTIN_ADAPTERS: ReadonlyArray<readonly [string, Adapter]> = [
  ["arxiv", arxivAdapter],
  ["devto", devtoAdapter],
  ["github", githubAdapter],
  ["github-releases", githubReleasesAdapter],
  ["hackernews", hackernewsAdapter],
  ["lemmy", lemmyAdapter],
  ["lobsters", lobstersAdapter],
  ["mastodon", mastodonAdapter],
  ["npm", npmAdapter],
  ["podcast", podcastAdapter],
  ["producthunt", producthuntAdapter],
  ["reddit", redditAdapter],
  ["rss", rssAdapter],
  ["stackexchange", stackexchangeAdapter],
  ["twitter", twitterAdapter],
  ["wikipedia", wikipediaAdapter],
  ["youtube", youtubeAdapter],
];

describe("builtin adapter contract", () => {
  test("each built-in adapter has trimmed name and fetch", () => {
    for (const [expectedName, adapter] of BUILTIN_ADAPTERS) {
      expect(adapter.name).toBe(expectedName);
      expect(adapter.name).toBe(adapter.name.trim());
      expect(typeof adapter.fetch).toBe("function");
    }
  });
});