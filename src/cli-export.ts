import { parseOpml, type OpmlGroup } from "./cli-import";
import { escapeXml } from "./server/api-panels-rss";
import { errorMessage, getAdapterName } from "./utils";
import type { AppConfig } from "./config/types";

/** Adapter types whose params carry a list of feed URLs, keyed to that param name. */
export const EXPORT_FEED_PARAM_KEYS: Record<string, string> = {
  rss: "urls",
  podcast: "feeds",
};

export type ExportCollectResult = {
  groups: OpmlGroup[];
  feedCount: number;
  /** Feeds dropped because the same URL already appeared in an earlier adapter. */
  duplicateCount: number;
  /** Names of configured adapters with no exportable feed URLs (non-feed types). */
  skippedAdapters: string[];
};

/**
 * Collect exportable feed URLs from a config: one OPML group per rss/podcast
 * adapter (titled by adapter name), in config order. Duplicate URLs keep the
 * first occurrence (mirrors `parseOpml`); adapters of other types are
 * reported in `skippedAdapters` so the CLI can warn.
 *
 * Throws when the config has no feed URLs at all.
 */
export function collectExportFeeds(config: AppConfig): ExportCollectResult {
  const groups: OpmlGroup[] = [];
  const skippedAdapters: string[] = [];
  const seenUrls = new Set<string>();
  let duplicateCount = 0;

  for (const adapter of config.adapters) {
    const paramKey = EXPORT_FEED_PARAM_KEYS[adapter.type];
    if (paramKey === undefined) {
      skippedAdapters.push(getAdapterName(adapter));
      continue;
    }
    const raw = adapter.params?.[paramKey];
    const urls = Array.isArray(raw) ? raw : [];
    const group: OpmlGroup = { title: getAdapterName(adapter), feeds: [] };
    for (const entry of urls) {
      if (typeof entry !== "string") continue;
      const url = entry.trim();
      if (url === "") continue;
      if (seenUrls.has(url)) {
        duplicateCount++;
        continue;
      }
      seenUrls.add(url);
      group.feeds.push({ title: url, xmlUrl: url });
    }
    if (group.feeds.length === 0) {
      skippedAdapters.push(group.title);
      continue;
    }
    groups.push(group);
  }

  const feedCount = groups.reduce((sum, g) => sum + g.feeds.length, 0);
  if (feedCount === 0) {
    throw new Error(
      "export: no rss or podcast feed URLs found in config (only rss and podcast adapters are exportable)",
    );
  }

  return { groups, feedCount, duplicateCount, skippedAdapters };
}

/**
 * Render collected feeds as an OPML 2.0 document (the standard import format
 * of Feedly, Inoreader, NewsBlur, Miniflux, etc.): one folder outline per
 * adapter, one `type="rss"` outline per feed URL. The output is validated by
 * round-tripping it through `parseOpml` before returning, so `pace import`
 * always accepts what `pace export` produced.
 *
 * `sourceLabel` is the config path/label used in the head title and errors.
 */
export function generateOpml(result: ExportCollectResult, sourceLabel: string): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<opml version="2.0">');
  lines.push("  <head>");
  lines.push(`    <title>${escapeXml(`pace feeds from ${sourceLabel}`)}</title>`);
  lines.push("  </head>");
  lines.push("  <body>");
  for (const group of result.groups) {
    const title = escapeXml(group.title);
    lines.push(`    <outline text="${title}" title="${title}">`);
    for (const feed of group.feeds) {
      const url = escapeXml(feed.xmlUrl);
      lines.push(`      <outline type="rss" text="${url}" title="${url}" xmlUrl="${url}"/>`);
    }
    lines.push("    </outline>");
  }
  lines.push("  </body>");
  lines.push("</opml>");

  const xml = lines.join("\n");

  // Guarantee the emitted OPML round-trips through `pace import` - a
  // generation bug should fail here, not in the user's feed reader (mirrors
  // the validation guard in generateImportedConfig).
  try {
    const roundTrip = parseOpml(xml, sourceLabel);
    if (roundTrip.feedCount !== result.feedCount) {
      throw new Error(
        `round-trip parsed ${roundTrip.feedCount} feeds, expected ${result.feedCount}`,
      );
    }
  } catch (err) {
    throw new Error(`export: internal error: generated OPML failed validation: ${errorMessage(err)}`);
  }

  return xml;
}

/** Stderr warnings for adapters/URLs the export dropped. Empty when clean. */
export function formatExportWarnings(result: ExportCollectResult): string[] {
  const warnings: string[] = [];
  if (result.skippedAdapters.length > 0) {
    const noun = result.skippedAdapters.length === 1 ? "adapter" : "adapters";
    warnings.push(
      `export: skipped ${result.skippedAdapters.length} ${noun} without feed URLs (${result.skippedAdapters.join(", ")})`,
    );
  }
  if (result.duplicateCount > 0) {
    const noun = result.duplicateCount === 1 ? "feed" : "feeds";
    warnings.push(`export: skipped ${result.duplicateCount} duplicate ${noun}`);
  }
  return warnings;
}

/** One-line result summary: "12 feeds from 3 adapters". */
export function formatExportSummary(result: ExportCollectResult): string {
  const feedNoun = result.feedCount === 1 ? "feed" : "feeds";
  const n = result.groups.length;
  const adapterNoun = n === 1 ? "adapter" : "adapters";
  return `${result.feedCount} ${feedNoun} from ${n} ${adapterNoun}`;
}

export function formatExportUsage(): string {
  return `Usage: pace export [output.opml]

Exports the feed URLs from the active config as an OPML 2.0 file you can
import into any feed reader (Feedly, Inoreader, NewsBlur, Miniflux, etc.):
one folder per rss or podcast adapter, one outline per feed URL. Prints
OPML to stdout, or writes it to [output.opml] when given.

Adapters of other types (hackernews, github, arxiv, ...) have no feed URL
and are skipped with a warning. The inverse of \`pace import\`.

Options:
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -P, --preset <name>   Use a bundled preset (tech-news, ml-ai, etc.)
  -C, --chdir <dir>     Change to directory (for config/output files)
`;
}
