import {
  formatBy,
  formatPercent,
  formatTags,
} from "./engagement";
import { joinTitle, joinTitleWithTagline } from "./title";

import { fetchJson } from "./fetch";
import { decodeNumericFeedTitle } from "./html";
import {
  clampAdapterLimit,
  normalizeOptionalString,
  normalizeStringList,
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
  return json.objects ?? [];
}

type SortBy = "optimal" | "quality" | "popularity" | "maintenance";

const VALID_SORTS = new Set<SortBy>(["optimal", "quality", "popularity", "maintenance"]);

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
    const keywords = normalizeStringList(
      (config.params?.keywords as string[]) ?? [],
    );
    const scope = normalizeOptionalString(
      config.params?.scope as string | undefined,
    );
    const limit = clampAdapterLimit(config.params?.limit, 20, 50);
    const sortParam = (config.params?.sort as string) ?? "optimal";

    const sortBy: SortBy = VALID_SORTS.has(sortParam as SortBy)
      ? (sortParam as SortBy)
      : "optimal";

    if (keywords.length === 0 && !scope) {
      console.warn("npm: no keywords or scope configured");
      return [];
    }

    const context = scope
      ? `@${scope} ${keywords.join(" ")}`.trim()
      : keywords.join(" ");

    const query = buildSearchQuery(keywords, scope, limit, sortBy);
    const results = await searchNpm(query, context);

    return results.map((result) => ({
      id: `npm:${result.package.name}@${result.package.version}`,
      title: joinTitleWithTagline(
        decodeNumericFeedTitle(result.package.name),
        result.package.description
          ? decodeNumericFeedTitle(result.package.description)
          : undefined,
      ),
      url: result.package.links.npm,
      source: scope ? `npm:@${scope}` : `npm:${sortBy}`,
      timestamp: new Date(result.package.date),
      body: buildBody(result),
    }));
  },
};

export default adapter;
