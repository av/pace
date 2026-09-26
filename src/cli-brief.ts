import {
  briefConfigLabel,
  buildBrief,
  buildBriefContext,
  DEFAULT_BRIEF_LIMIT,
  DEFAULT_BRIEF_PER_PANEL,
  DEFAULT_BRIEF_SINCE,
  formatBriefSummary,
  MAX_BRIEF_LIMIT,
  MAX_BRIEF_PER_PANEL,
  parseBriefLimit,
  parseBriefPerPanel,
  parseBriefSince,
  renderBriefJson,
  renderBriefMarkdown,
  resolveBriefPanelIds,
} from "./brief";
import type { AppConfig } from "./config/types";

export function formatBriefUsage(): string {
  return `Usage:
  pace brief [options]         Print the agent brief from stored items

The brief is what the dashboard's panels show, narrowed to a time window,
deduped across panels, ranked, and capped: the same document GET /api/brief
(JSON) and GET /brief.md (Markdown) serve. It reads the local database only
(no fetching), so run \`pace serve\` or let the scheduler fill it first.
Schema: docs/brief.md.

Examples:
  pace brief -P ml-ai
  pace brief -P ml-ai --since 24h --limit 20
  pace brief --json --panel papers --panel blogs

Options:
      --md                Markdown (default)
      --json              The pace.brief/v1 JSON document
      --panel <id|name>   Only these panels (repeatable or comma-separated;
                          default: every panel except bookmarks/counter ones)
      --since <window>    Duration (90m, 24h, 3d, 1w), ISO date, or all
                          (default: ${DEFAULT_BRIEF_SINCE})
  -n, --limit <n>         Maximum items in the brief (1-${MAX_BRIEF_LIMIT}, default ${DEFAULT_BRIEF_LIMIT})
      --per-panel <n>     Maximum items per panel (1-${MAX_BRIEF_PER_PANEL}, default ${DEFAULT_BRIEF_PER_PANEL})
  -c, --config <path>     Path to config file (default: ./config.yaml)
  -P, --preset <name>     Use a bundled preset config
  -C, --chdir <dir>       Change to directory (for config/data loads)
`;
}

export interface BriefCliValues {
  json?: boolean;
  md?: boolean;
  panel?: string[];
  since?: string;
  limit?: string;
  perPanel?: string;
  preset?: string;
}

/**
 * Build and render the brief for \`pace brief\`. Throws a \`brief:\`-prefixed
 * error for invalid options, with the same messages the endpoints return.
 */
export function runBriefCli(
  config: AppConfig,
  values: BriefCliValues,
  configPath: string | undefined,
  now = new Date(),
): { output: string; summary: string } {
  if (values.json === true && values.md === true) {
    throw new Error("brief: --json and --md cannot be combined");
  }
  const label = values.preset !== undefined ? `preset:${values.preset}` : briefConfigLabel(configPath);
  const ctx = buildBriefContext(config, label);
  const check = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
    if (!result.ok) throw new Error(`brief: ${result.error}`);
    return result.value;
  };
  const panelIds = check(resolveBriefPanelIds(values.panel ?? [], ctx));
  const limit = check(parseBriefLimit(values.limit));
  const perPanel = check(parseBriefPerPanel(values.perPanel));
  const since = check(parseBriefSince(values.since, now));
  const doc = buildBrief(ctx, { panelIds, limit, perPanel, since }, now);
  const format = values.json === true ? "json" : "markdown";
  const output = format === "json" ? renderBriefJson(doc) : renderBriefMarkdown(doc, ctx).trimEnd();
  return { output, summary: formatBriefSummary(doc, format) };
}
