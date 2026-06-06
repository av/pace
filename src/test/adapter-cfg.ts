import type { AdapterType } from "../adapters/params";
import { adapterCfg } from "./adapter-mocks";

function makeAdapterCfg(type: AdapterType) {
  return (params: Record<string, unknown> = {}) => adapterCfg(type, params);
}

export const arxivCfg = makeAdapterCfg("arxiv");
export const devtoCfg = makeAdapterCfg("devto");
export const githubCfg = makeAdapterCfg("github");
export const githubReleasesCfg = makeAdapterCfg("github-releases");
export const hnCfg = makeAdapterCfg("hackernews");
export const lemmyCfg = makeAdapterCfg("lemmy");
export const lobstersCfg = makeAdapterCfg("lobsters");
export const mastodonCfg = makeAdapterCfg("mastodon");
export const npmCfg = makeAdapterCfg("npm");
export const podcastCfg = makeAdapterCfg("podcast");
export const producthuntCfg = makeAdapterCfg("producthunt");
export const redditCfg = makeAdapterCfg("reddit");
export const rssCfg = makeAdapterCfg("rss");
export const seCfg = makeAdapterCfg("stackexchange");
export const twitterCfg = makeAdapterCfg("twitter");
export const wikiCfg = makeAdapterCfg("wikipedia");
export const youtubeCfg = makeAdapterCfg("youtube");