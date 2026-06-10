import {
  formatBy,
  formatPercent,
  formatTags,
} from "./engagement";
import { joinTitle, joinTitleWithTagline } from "./title";

import { mapToContentItems } from "./content-item";
import { warnEmptyConfig } from "./empty-config";
import { arrayFieldOrEmpty, fetchJson } from "./fetch";
import { decodeNumericFeedTitle } from "./html";
import {
  clampAdapterLimit,
  normalizeParamString,
  normalizeParamStringList,
  createAliasedResolver,
} from "../utils";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

const NPM_REGISTRY = "https://registry.npmjs.org";

interface NpmSearchResult {
  objects: NpmPackageResult[];
  total: number;
}

interface NpmPackageResult {
  package: {
    name: string;
    version: string;
    description?: string;
    date: string;
    links: {
      npm: string;
      homepage?: string;
      repository?: string;
    };
    publisher?: {
      username: string;
    };
    keywords?: string[];
  };
  score: {
    final: number;
    detail: {
      quality: number;
      popularity: number;
      maintenance: number;
    };
  };
}

function buildBody(result: NpmPackageResult): string {
  const pkg = result.package;
  const scores = result.score.detail;

  return joinTitle(
    `v${pkg.version}`,
    pkg.publisher?.username ? formatBy(pkg.publisher.username) : undefined,
    `quality: ${formatPercent(scores.quality)}`,
    `popularity: ${formatPercent(scores.popularity)}`,
    `maintenance: ${formatPercent(scores.maintenance)}`,
    formatTags((pkg.keywords ?? []).slice(0, 5)),
    pkg.links.repository ? `repo: ${pkg.links.repository}` : undefined,
  );
}

async function searchNpm(
  query: Record<string, string>,
  context: string,
): Promise<NpmPackageResult[]> {
  const params = new URLSearchParams(query);
  const url = `${NPM_REGISTRY}/-/v1/search?${params.toString()}`;

  const json = await fetchJson<NpmSearchResult>("npm", url, context, {
    accept: "application/json",
  });
  return arrayFieldOrEmpty<NpmPackageResult>("npm", json, "objects", context);
}

type SortBy = "optimal" | "quality" | "popularity" | "maintenance";

/** Build npm source label: scoped searches use @scope, keyword searches use sort mode. */
export function npmSourceLabel(scope: string | undefined, sortBy: SortBy): string {
  return scope ? `npm:@${scope}` : `npm:${sortBy}`;
}

/** Map configured sort string (canonical name or alias) to npm search sort. Unknown → optimal. */
export const resolveNpmSort = createAliasedResolver<SortBy>({
  types: ["optimal", "quality", "popularity", "maintenance"],
  aliases: { popular: "popularity", maint: "maintenance", default: "optimal" },
  fallback: "optimal",
});

function buildSearchQuery(
  keywords: string[],
  scope: string | undefined,
  limit: number,
  sortBy: SortBy,
): Record<string, string> {
  const textParts: string[] = [];

  if (scope) {
    textParts.push(`scope:${scope}`);
  }

  textParts.push(...keywords);

  const query: Record<string, string> = {
    text: textParts.join(" "),
    size: String(limit),
  };

  if (sortBy === "quality") {
    query["quality"] = "1.0";
    query["popularity"] = "0.0";
    query["maintenance"] = "0.0";
  } else if (sortBy === "popularity") {
    query["quality"] = "0.0";
    query["popularity"] = "1.0";
    query["maintenance"] = "0.0";
  } else if (sortBy === "maintenance") {
    query["quality"] = "0.0";
    query["popularity"] = "0.0";
    query["maintenance"] = "1.0";
  }

  return query;
}

const adapter: Adapter = {
  name: "npm",
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const keywords = normalizeParamStringList(config.params, "keywords");
    const scope = normalizeParamString(config.params, "scope");
    const limit = clampAdapterLimit(config.params?.limit, 20, 50);
    const sortBy = resolveNpmSort(
      normalizeParamString(config.params, "sort", "optimal"),
    );

    if (keywords.length === 0 && !scope) {
      return warnEmptyConfig("npm", "no keywords or scope configured");
    }

    const context = scope
      ? `@${scope} ${keywords.join(" ")}`.trim()
      : keywords.join(" ");

    const query = buildSearchQuery(keywords, scope, limit, sortBy);
    const results = await searchNpm(query, context);

    return mapToContentItems(results, npmSourceLabel(scope, sortBy), (result) => ({
      id: `npm:${result.package.name}@${result.package.version}`,
      title: joinTitleWithTagline(
        decodeNumericFeedTitle(result.package.name),
        result.package.description
          ? decodeNumericFeedTitle(result.package.description)
          : undefined,
      ),
      url: result.package.links.npm,
      timestamp: new Date(result.package.date),
      body: buildBody(result),
    }));
  },
};

export default adapter;
