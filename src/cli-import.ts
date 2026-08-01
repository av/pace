import { XMLParser } from "fast-xml-parser";
import { decodeHtmlEntities } from "./adapters/html";
import { parseAndValidateConfig } from "./config";
import { errorMessage } from "./utils";

/** Default refresh interval (minutes) for adapters generated from an OPML import. */
export const IMPORT_DEFAULT_REFRESH_MIN = 30;

/** Default per-panel item limit for panels generated from an OPML import. */
export const IMPORT_DEFAULT_PANEL_LIMIT = 20;

/** Panels per layout row when the import produces more than one row. */
export const IMPORT_PANELS_PER_ROW = 3;

/** Group title for feeds that sit directly under <body> (no folder outline). */
export const IMPORT_ROOT_GROUP_TITLE = "Feeds";

export type OpmlFeed = {
  title: string;
  xmlUrl: string;
};

export type OpmlGroup = {
  /** Folder path joined with " / " for nested folders; "Feeds" for root-level feeds. */
  title: string;
  feeds: OpmlFeed[];
};

export type OpmlParseResult = {
  groups: OpmlGroup[];
  feedCount: number;
  /** Leaf outlines that had neither an xmlUrl nor children. */
  skippedNoXmlUrl: number;
  /** Feeds dropped because the same xmlUrl already appeared earlier. */
  duplicateCount: number;
};

// OPML attribute values arrive entity-encoded (&amp;); fast-xml-parser decodes
// the XML layer, and decodeHtmlEntities handles the double-encoded titles some
// exporters produce ("AT&amp;amp;T" -> "AT&T").
const opmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep values as strings so a feed titled "1984" stays a title (mirrors
  // FEED_XML_PARSER_OPTIONS in adapters/atom.ts).
  parseTagValue: false,
  parseAttributeValue: false,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attrString(outline: Record<string, unknown>, name: string): string | null {
  const value = outline[`@_${name}`];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanTitle(raw: string): string {
  return decodeHtmlEntities(raw, { numeric: true }).replace(/\s+/g, " ").trim();
}

function outlineTitle(outline: Record<string, unknown>): string | null {
  const raw = attrString(outline, "title") ?? attrString(outline, "text");
  if (raw === null) return null;
  const cleaned = cleanTitle(raw);
  return cleaned === "" ? null : cleaned;
}

/**
 * Parse an OPML document (feed-reader export) into feed groups: one group per
 * folder outline (nested folders join with " / "), plus a root group for
 * feeds directly under <body>. Duplicate xmlUrls keep the first occurrence.
 *
 * `context` is the file path/label used in error messages.
 */
export function parseOpml(xml: string, context: string): OpmlParseResult {
  let parsed: unknown;
  try {
    parsed = opmlParser.parse(xml);
  } catch (err) {
    throw new Error(`import: error parsing xml from ${context}: ${errorMessage(err)}`);
  }

  // A document without an <opml> root is not OPML at all (HTML page, RSS
  // feed, JSON). fast-xml-parser accepts such bodies without throwing, so
  // fail loudly instead of reporting zero feeds (mirrors the "not an
  // RSS/Atom feed" guard in adapters/fetch.ts).
  if (!isRecord(parsed) || !isRecord(parsed.opml)) {
    throw new Error(`import: ${context} is not an OPML file (no <opml> root)`);
  }
  const body = parsed.opml.body;
  if (!isRecord(body)) {
    throw new Error(`import: ${context} is not an OPML file (missing <body>)`);
  }

  const groups = new Map<string, OpmlGroup>();
  const seenUrls = new Set<string>();
  let skippedNoXmlUrl = 0;
  let duplicateCount = 0;

  function addFeed(folderPath: string[], feed: OpmlFeed): void {
    const title = folderPath.length === 0 ? IMPORT_ROOT_GROUP_TITLE : folderPath.join(" / ");
    let group = groups.get(title);
    if (!group) {
      group = { title, feeds: [] };
      groups.set(title, group);
    }
    group.feeds.push(feed);
  }

  function walk(outlines: unknown[], folderPath: string[]): void {
    for (const node of outlines) {
      if (!isRecord(node)) continue;
      const xmlUrl = attrString(node, "xmlUrl");
      const children = asArray(node.outline);

      if (xmlUrl !== null) {
        if (seenUrls.has(xmlUrl)) {
          duplicateCount++;
        } else {
          seenUrls.add(xmlUrl);
          addFeed(folderPath, { title: outlineTitle(node) ?? xmlUrl, xmlUrl });
        }
        // A feed outline should not have children, but if it does, treat
        // them as members of the current folder rather than dropping them.
        if (children.length > 0) walk(children, folderPath);
      } else if (children.length > 0) {
        walk(children, [...folderPath, outlineTitle(node) ?? "Folder"]);
      } else {
        // Leaf without an xmlUrl: a feed entry the exporter broke, or a
        // decorative separator. Count it so the CLI can warn.
        skippedNoXmlUrl++;
      }
    }
  }

  walk(asArray(body.outline), []);

  const groupList = [...groups.values()];
  const feedCount = groupList.reduce((sum, g) => sum + g.feeds.length, 0);
  if (feedCount === 0) {
    throw new Error(`import: no feeds with an xmlUrl found in ${context}`);
  }

  return { groups: groupList, feedCount, skippedNoXmlUrl, duplicateCount };
}

/** Double-quoted YAML scalar (JSON string escaping is valid YAML). */
function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") return "feeds";
  // "all" is the special merge-every-source panel source; an adapter with
  // that name would shadow it.
  if (slug === "all") return "all-feeds";
  return slug;
}

/** Unique adapter name per group, in group order (tech, tech-2, ...). */
export function assignAdapterNames(groups: OpmlGroup[]): string[] {
  const used = new Set<string>();
  return groups.map((group) => {
    const base = slugify(group.title);
    let name = base;
    for (let n = 2; used.has(name); n++) {
      name = `${base}-${n}`;
    }
    used.add(name);
    return name;
  });
}

/** Split panels into layout rows of at most IMPORT_PANELS_PER_ROW. */
function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

/** A "# Title" YAML comment suffix, or "" when the title adds nothing. */
function urlComment(feed: OpmlFeed): string {
  if (feed.title === feed.xmlUrl) return "";
  return ` # ${feed.title.replace(/[\r\n]+/g, " ")}`;
}

/**
 * Render an OPML parse result as a ready-to-use pace config: one rss adapter
 * and one panel per group, laid out in rows of IMPORT_PANELS_PER_ROW panels.
 * The output is validated with the real config pipeline before returning.
 */
export function generateImportedConfig(result: OpmlParseResult, sourceLabel: string): string {
  const names = assignAdapterNames(result.groups);
  const lines: string[] = [];

  const folderNoun = result.groups.length === 1 ? "folder" : "folders";
  const feedNoun = result.feedCount === 1 ? "feed" : "feeds";
  lines.push(`# pace config generated by \`pace import\` from ${sourceLabel}`);
  lines.push(
    `# ${result.feedCount} ${feedNoun} in ${result.groups.length} ${folderNoun}. Review, then validate with: pace config check`,
  );
  lines.push("");
  lines.push("adapters:");
  result.groups.forEach((group, i) => {
    lines.push(`  - name: ${yamlQuote(names[i])}`);
    lines.push("    type: rss");
    lines.push("    params:");
    lines.push("      urls:");
    for (const feed of group.feeds) {
      lines.push(`        - ${yamlQuote(feed.xmlUrl)}${urlComment(feed)}`);
    }
    lines.push(`    refresh_interval: ${IMPORT_DEFAULT_REFRESH_MIN}`);
  });

  const panelLines = (indent: string) => (group: OpmlGroup, index: number) => [
    `${indent}- panel: ${yamlQuote(group.title)}`,
    `${indent}  source: ${yamlQuote(names[index])}`,
    `${indent}  flex: 1`,
    `${indent}  limit: ${IMPORT_DEFAULT_PANEL_LIMIT}`,
  ];

  lines.push("");
  lines.push("layout:");
  if (result.groups.length <= IMPORT_PANELS_PER_ROW) {
    lines.push("  direction: row");
    lines.push("  children:");
    result.groups.forEach((group, i) => lines.push(...panelLines("    ")(group, i)));
  } else {
    lines.push("  direction: column");
    lines.push("  children:");
    const rows = chunk(
      result.groups.map((group, i) => ({ group, i })),
      IMPORT_PANELS_PER_ROW,
    );
    for (const row of rows) {
      lines.push("    - direction: row");
      lines.push("      flex: 1");
      lines.push("      children:");
      for (const { group, i } of row) {
        lines.push(...panelLines("        ")(group, i));
      }
    }
  }
  lines.push("");

  const yamlText = lines.join("\n");

  // Guarantee the emitted config passes `pace config check` - a generation
  // bug should fail here, not in the user's hands.
  try {
    parseAndValidateConfig({ raw: yamlText, usedConfigPath: sourceLabel });
  } catch (err) {
    throw new Error(
      `import: internal error: generated config failed validation: ${errorMessage(err)}`,
    );
  }

  return yamlText;
}

/** Stderr warnings for outlines/feeds the import dropped. Empty when clean. */
export function formatImportWarnings(result: OpmlParseResult): string[] {
  const warnings: string[] = [];
  if (result.skippedNoXmlUrl > 0) {
    const noun = result.skippedNoXmlUrl === 1 ? "outline" : "outlines";
    warnings.push(`import: skipped ${result.skippedNoXmlUrl} ${noun} without an xmlUrl`);
  }
  if (result.duplicateCount > 0) {
    const noun = result.duplicateCount === 1 ? "feed" : "feeds";
    warnings.push(`import: skipped ${result.duplicateCount} duplicate ${noun}`);
  }
  return warnings;
}

/** One-line result summary: "12 feeds in 3 folders -> 3 adapters, 3 panels". */
export function formatImportSummary(result: OpmlParseResult): string {
  const feedNoun = result.feedCount === 1 ? "feed" : "feeds";
  const folderNoun = result.groups.length === 1 ? "folder" : "folders";
  const n = result.groups.length;
  return `${result.feedCount} ${feedNoun} in ${n} ${folderNoun} -> ${n} adapters, ${n} panels`;
}

export function formatImportUsage(): string {
  return `Usage: pace import <feeds.opml> [output.yaml]

Converts an OPML feed-reader export into a ready-to-use pace config:
one rss adapter and one panel per OPML folder (nested folders join with
" / "; feeds outside any folder land in a "${IMPORT_ROOT_GROUP_TITLE}" panel). Prints YAML to
stdout, or writes it to [output.yaml] when given.

Validate the result with \`pace config check\` before serving.

Options:
  -C, --chdir <dir>   Change to directory (for reading/writing files)
`;
}
