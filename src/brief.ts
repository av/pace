/**
 * The agent brief: pre-fetched, ranked context an agent reads once.
 *
 * A brief is built from what each dashboard panel already shows (same panel
 * limits, same dedup window), narrowed to a time window, deduped across
 * panels, scored with a small deterministic formula, and capped per panel
 * and overall. It renders as a versioned JSON document (GET /api/brief,
 * `pace brief --json`) or as Markdown meant for one LLM read (GET /brief.md,
 * `pace brief`). The schema is documented in docs/brief.md; anything that
 * changes a field's meaning must bump BRIEF_SCHEMA.
 */
import { basename } from "node:path";
import { htmlToText } from "./html-to-text";
import { stripClusterAnnotationPrefixes } from "./cluster-signals";
import {
  DEFAULT_PANEL_LIMIT,
  itemSeenKey,
  loadDashboardPanelData,
  type ContentItemRow,
} from "./db";
import { buildLayoutRuntimeMaps, type DashboardPanel, type LayoutNodeConfig } from "./layout/types";
import { toApiTimestamp } from "./server/api-panels";
import { getAdapterName, parseJsonStringArray } from "./utils";
import type { AppConfig } from "./config/types";

export const BRIEF_SCHEMA = "pace.brief/v1";

export const DEFAULT_BRIEF_LIMIT = 40;
export const MAX_BRIEF_LIMIT = 200;
export const DEFAULT_BRIEF_PER_PANEL = 8;
export const MAX_BRIEF_PER_PANEL = 50;
export const DEFAULT_BRIEF_SINCE = "72h";
export const BRIEF_SUMMARY_MAX_CHARS = 280;
/** Items from one source picked per panel before other sources get a turn. */
export const BRIEF_SOURCE_SOFT_CAP = 3;
/** Recency half-life of the brief score. */
export const BRIEF_RECENCY_HALF_LIFE_MS = 24 * 60 * 60_000;
/** Adapter types whose items are reference links or metrics, not news. */
export const BRIEF_NON_FEED_ADAPTER_TYPES: ReadonlySet<string> = new Set(["bookmarks", "counter"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BriefPanelKind = "adapter" | "pipeline" | "all";

/** Config facts the brief needs beyond the layout maps. */
export interface BriefConfigInfo {
  /** Human label for the active config: "preset:ml-ai" or a file name. */
  configLabel: string;
  /** Adapter/pipeline source names that feed reference links or metrics. */
  nonFeedSources: ReadonlySet<string>;
  /** Configured pipeline names. */
  pipelineNames: ReadonlySet<string>;
}

/** Layout maps plus config info: everything buildBrief reads besides the database. */
export interface BriefContext extends BriefConfigInfo {
  dashboardPanels: readonly DashboardPanel[];
  panelNameToId: ReadonlyMap<string, string>;
  panelIdToRefreshSourceNames: ReadonlyMap<string, string[]>;
}

export interface BriefSince {
  /** Items published before this instant are dropped; null keeps everything. */
  cutoff: Date | null;
  /** How the window was asked for: a duration ("72h"), "all", or "since <iso>". */
  label: string;
}

export interface BriefOptions {
  /** Explicit panel ids to include; undefined = every feed panel. */
  panelIds?: string[];
  limit: number;
  perPanel: number;
  since: BriefSince;
}

export interface BriefItem {
  n: number;
  id: string;
  title: string;
  url: string;
  source: string;
  panel: string;
  panel_name: string;
  also_in: string[];
  score: number;
  llm_score: number | null;
  engagement: Record<string, number>;
  summary: string | null;
  why_ranked: string[];
  published_at: string;
  fetched_at: string;
  discussion_url: string | null;
}

export interface BriefPanel {
  id: string;
  name: string;
  kind: BriefPanelKind;
  last_refreshed_at: string | null;
  candidates: number;
  older_than_window: number;
  listed_elsewhere: number;
  selected: number;
}

export interface BriefCounts {
  panels: number;
  candidates: number;
  older_than_window: number;
  duplicates_merged: number;
  selected: number;
  cut_by_limits: number;
}

export interface BriefDocument {
  schema: typeof BRIEF_SCHEMA;
  generated_at: string;
  config: string;
  scope: {
    panels: string[];
    skipped_panels: string[];
    since: string | null;
    window: string;
    limit: number;
    per_panel: number;
  };
  counts: BriefCounts;
  token_estimate: { method: "chars/4"; markdown: number; json: number };
  panels: BriefPanel[];
  items: BriefItem[];
}

// ---------------------------------------------------------------------------
// Option parsing (shared by the endpoints and the CLI)
// ---------------------------------------------------------------------------

export type BriefParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function parseBoundedInt(
  name: string,
  raw: string | undefined,
  fallback: number,
  max: number,
): BriefParseResult<number> {
  if (raw === undefined) return { ok: true, value: fallback };
  if (!/^\d+$/.test(raw)) return { ok: false, error: `${name} must be a positive integer` };
  const value = Number(raw);
  if (value < 1 || value > max) {
    return { ok: false, error: `${name} must be between 1 and ${max}` };
  }
  return { ok: true, value };
}

export function parseBriefLimit(raw: string | undefined): BriefParseResult<number> {
  return parseBoundedInt("limit", raw, DEFAULT_BRIEF_LIMIT, MAX_BRIEF_LIMIT);
}

export function parseBriefPerPanel(raw: string | undefined): BriefParseResult<number> {
  return parseBoundedInt("per_panel", raw, DEFAULT_BRIEF_PER_PANEL, MAX_BRIEF_PER_PANEL);
}

const DURATION_UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  w: 7 * 24 * 60 * 60_000,
};

/**
 * Parse the since window: a duration (`90m`, `24h`, `3d`, `1w`) counted back
 * from `now`, an ISO date or datetime, or `all` for no cutoff. Absent → the
 * default window.
 */
export function parseBriefSince(
  raw: string | undefined,
  now: Date,
): BriefParseResult<BriefSince> {
  const value = (raw ?? DEFAULT_BRIEF_SINCE).trim();
  if (value.toLowerCase() === "all") return { ok: true, value: { cutoff: null, label: "all" } };
  const duration = /^(\d+)([mhdw])$/i.exec(value);
  if (duration) {
    const amount = Number(duration[1]);
    if (amount < 1) return { ok: false, error: "since duration must be at least 1" };
    const unit = duration[2]!.toLowerCase();
    return {
      ok: true,
      value: {
        cutoff: new Date(now.getTime() - amount * DURATION_UNIT_MS[unit]!),
        label: `${amount}${unit}`,
      },
    };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      const iso = parsed.toISOString();
      return { ok: true, value: { cutoff: parsed, label: `since ${iso}` } };
    }
  }
  return {
    ok: false,
    error: "since must be a duration like 90m, 24h, 3d or 1w, an ISO date, or all",
  };
}

/**
 * Resolve panel filter values (ids or display names; each value may be a
 * comma-separated list) to panel ids in the order given, without duplicates.
 * A value that names a panel as a whole wins over comma splitting, so display
 * names containing commas still resolve.
 */
export function resolveBriefPanelIds(
  values: readonly string[],
  ctx: Pick<BriefContext, "dashboardPanels" | "panelNameToId">,
): BriefParseResult<string[] | undefined> {
  if (values.length === 0) return { ok: true, value: undefined };
  const known = new Set(ctx.dashboardPanels.map((panel) => panel.pid));
  const resolveOne = (name: string): string | undefined => {
    const id = ctx.panelNameToId.get(name) ?? name;
    return known.has(id) ? id : undefined;
  };
  const ids: string[] = [];
  for (const value of values) {
    const whole = resolveOne(value.trim());
    const parts = whole !== undefined ? [value.trim()] : value.split(",").map((p) => p.trim());
    for (const part of parts) {
      if (part === "") continue;
      const id = resolveOne(part);
      if (id === undefined) return { ok: false, error: `Unknown panel: ${part}` };
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return { ok: true, value: ids.length > 0 ? ids : undefined };
}

// ---------------------------------------------------------------------------
// Config context
// ---------------------------------------------------------------------------

/**
 * Label the active config for the brief header: bundled presets become
 * "preset:<name>", anything else its file name (never a full path, so the
 * brief does not leak the host's directory layout).
 */
export function briefConfigLabel(configPath: string | undefined): string {
  if (configPath === undefined || configPath === "") return "config.yaml";
  const preset = /(?:^|[\\/])presets[\\/]config\.([\w-]+)\.yaml$/.exec(configPath);
  if (preset) return `preset:${preset[1]}`;
  if (!configPath.includes("/") && !configPath.includes("\\") && !configPath.endsWith(".yaml")) {
    return `preset:${configPath}`;
  }
  return basename(configPath);
}

export function buildBriefConfigInfo(config: AppConfig, configLabel: string): BriefConfigInfo {
  const nonFeedSources = new Set<string>();
  for (const adapter of config.adapters) {
    if (BRIEF_NON_FEED_ADAPTER_TYPES.has(adapter.type)) nonFeedSources.add(getAdapterName(adapter));
  }
  return {
    configLabel,
    nonFeedSources,
    pipelineNames: new Set((config.pipelines ?? []).map((pipeline) => pipeline.name)),
  };
}

export function buildBriefContext(config: AppConfig, configLabel: string): BriefContext {
  const maps = buildLayoutRuntimeMaps(
    config.layout as LayoutNodeConfig,
    config.adapters.map(getAdapterName),
    config.pipelines,
  );
  return {
    ...buildBriefConfigInfo(config, configLabel),
    dashboardPanels: maps.dashboardPanels,
    panelNameToId: maps.panelNameToId,
    panelIdToRefreshSourceNames: maps.panelIdToRefreshSourceNames,
  };
}

function panelKind(panel: DashboardPanel, ctx: BriefContext): BriefPanelKind {
  if (panel.isAll) return "all";
  const sources = ctx.panelIdToRefreshSourceNames.get(panel.pid) ?? [];
  return sources.some((name) => ctx.pipelineNames.has(name)) ? "pipeline" : "adapter";
}

function isNonFeedPanel(panel: DashboardPanel, ctx: BriefContext): boolean {
  if (panel.isAll) return false;
  const sources = ctx.panelIdToRefreshSourceNames.get(panel.pid) ?? [];
  return sources.length > 0 && sources.every((name) => ctx.nonFeedSources.has(name));
}

// ---------------------------------------------------------------------------
// Body parsing: summary, engagement, annotations
// ---------------------------------------------------------------------------

const COUNT = "\\d{1,3}(?:,\\d{3})+|\\d+";
/** Engagement terms and their weight in the engagement signal (comments count half). */
const ENGAGEMENT_TERMS: ReadonlyArray<{ key: string; re: RegExp; weight: number }> = [
  { key: "points", re: /^points?$/i, weight: 1 },
  { key: "upvotes", re: /^upvotes?$/i, weight: 1 },
  { key: "stars", re: /^stars?$/i, weight: 1 },
  { key: "likes", re: /^likes?$/i, weight: 1 },
  { key: "boosts", re: /^boosts?$/i, weight: 1 },
  { key: "favorites", re: /^favou?rites?$/i, weight: 1 },
  { key: "comments", re: /^comments?$/i, weight: 0.5 },
  { key: "replies", re: /^replies$|^reply$/i, weight: 0.5 },
];
const METRIC_SEGMENT_RE = new RegExp(`^(${COUNT})\\s+([a-z][a-z ()]*)$`, "i");
const SCORE_SEGMENT_RE = /^score:\s*(\d+)$/i;
const DISCUSS_SEGMENT_RE = /^discuss:\s*(\S+)$/i;
/** Body segments that are metadata, not prose. */
const METADATA_SEGMENT_RES: readonly RegExp[] = [
  /^by\s+\S/i,
  /^[cr]\/\S+$/,
  /^@\S+$/,
  /^(authors?|categories|tags|topics|language|site|cover|media|published|updated|license|version):/i,
];
const ANNOTATION_SPLIT_RE = /\n---\n(?=\[)/;
const KEYWORD_ANNOTATION_RE = /^\[keyword-score:\s*(-?[\d.]+)\]\s*(.*)$/;
const CLUSTER_PREFIX_RE = /^\s*\[([^\][\n]{1,80})\]\s+/;

export interface ParsedBriefBody {
  summary: string | null;
  engagement: Record<string, number>;
  engagementScore: number;
  discussionUrl: string | null;
  keywordScore: { score: number; terms: string } | null;
  clusterLabel: string | null;
}

/**
 * Lines with no prose once links and markers are gone: link-only bullets
 * (release download lists), bare bold labels ("**Website:**"), and
 * <details>/<summary> wrappers.
 */
function isBoilerplateLine(line: string): boolean {
  const rest = line
    .replace(/<\/?(details|summary)[^>]*>/gi, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\[[^\]]*\]\([^)]*\)|<https?:\/\/[^>\s]+>/g, "")
    .replace(/\b(DISABLED|ENABLED)\b/g, "")
    .trim();
  if (/^[\s\-–·|,]*$/.test(rest)) return true;
  return /^(\*\*|__)[^*_]{1,40}:?(\*\*|__):?$/.test(rest) || /^[\w /()-]{1,40}:$/.test(rest);
}

/** Light Markdown cleanup for release notes and README-ish bodies. */
function stripMarkdown(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !isBoilerplateLine(line))
    .join("\n")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|`)/g, "");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cap at `max` characters on a word boundary, ending with an ellipsis. */
export function capBriefText(text: string, max = BRIEF_SUMMARY_MAX_CHARS): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const cut = slice.lastIndexOf(" ");
  return `${(cut > max * 0.6 ? slice.slice(0, cut) : slice).replace(/[\s,;:.-]+$/, "")}…`;
}

/**
 * Split a stored body into the prose worth showing an agent and the signals
 * worth ranking on. Adapters join metadata into the body with " | "
 * (points, author, discussion link, arXiv authors/categories); transforms
 * append "\n---\n[keyword-score: …]" annotations and prefix "[cluster] "
 * labels. None of that is summary text.
 */
export function parseBriefBody(body: string | null, clustered = false): ParsedBriefBody {
  const result: ParsedBriefBody = {
    summary: null,
    engagement: {},
    engagementScore: 0,
    discussionUrl: null,
    keywordScore: null,
    clusterLabel: null,
  };
  if (!body) return result;

  const [main = "", ...annotations] = body.split(ANNOTATION_SPLIT_RE);
  for (const annotation of annotations) {
    const keyword = KEYWORD_ANNOTATION_RE.exec(annotation.trim());
    if (keyword) {
      result.keywordScore = { score: Number(keyword[1]), terms: collapse(keyword[2] ?? "") };
    }
  }

  let text = main;
  if (clustered) {
    const cluster = CLUSTER_PREFIX_RE.exec(text);
    if (cluster) result.clusterLabel = cluster[1]!;
    text = stripClusterAnnotationPrefixes(text);
  }

  // Abstracts (arXiv and friends) are the only prose in an otherwise
  // metadata-only body; take everything after the label.
  const abstract = /(?:^|\|)\s*Abstract:\s*([\s\S]*)$/i.exec(text);
  const prose: string[] = [];
  const segments = abstract ? text.slice(0, abstract.index).split(" | ") : text.split(" | ");
  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (segment === "") continue;
    const metric = METRIC_SEGMENT_RE.exec(segment);
    if (metric) {
      const term = ENGAGEMENT_TERMS.find((t) => t.re.test(metric[2]!.trim()));
      if (term && result.engagement[term.key] === undefined) {
        const count = Number(metric[1]!.replace(/,/g, ""));
        result.engagement[term.key] = count;
        result.engagementScore += Math.floor(count * term.weight);
      }
      continue;
    }
    const score = SCORE_SEGMENT_RE.exec(segment);
    if (score) {
      if (result.engagement.points === undefined) {
        result.engagement.points = Number(score[1]);
        result.engagementScore += Number(score[1]);
      }
      continue;
    }
    const discuss = DISCUSS_SEGMENT_RE.exec(segment);
    if (discuss) {
      result.discussionUrl = discuss[1]!;
      continue;
    }
    if (METADATA_SEGMENT_RES.some((re) => re.test(segment))) continue;
    if (!abstract) prose.push(segment);
  }
  if (abstract) prose.push(abstract[1]!);

  const joined = prose.join(" ");
  // Markdown first: it works line by line and turns <https://…> autolinks
  // into text before HTML stripping would read them as tags.
  const markdownless = stripMarkdown(joined);
  const plain = collapse(
    /<[a-z!/][^>]*>/i.test(markdownless) ? htmlToText(markdownless) : markdownless,
  ).replace(/\s+([.,;:!?])(?=\s|$)/g, "$1");
  result.summary = plain === "" ? null : capBriefText(plain);
  return result;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

interface Candidate {
  row: ContentItemRow;
  panel: DashboardPanel;
  kind: BriefPanelKind;
  layoutIndex: number;
}

interface Story {
  key: string;
  titleKey: string | null;
  home: Candidate;
  rows: Candidate[];
}

const KIND_RANK: Record<BriefPanelKind, number> = { adapter: 0, pipeline: 1, all: 2 };

function titleDedupKey(title: string): string | null {
  const key = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // Short titles ("Release notes", "Weekly update") collide across unrelated
  // stories; only merge on titles specific enough to be the same story.
  return key.length >= 20 ? key : null;
}

function prefersAsHome(a: Candidate, b: Candidate): boolean {
  const byKind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (byKind !== 0) return byKind < 0;
  return a.layoutIndex < b.layoutIndex;
}

function timestampMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** "40m", "5h", "3d" — compact age for why lines and Markdown. */
export function formatBriefAge(publishedAt: string, now: Date): string {
  const diff = Math.max(0, now.getTime() - timestampMs(publishedAt));
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatEngagement(engagement: Record<string, number>): string | null {
  const parts = Object.entries(engagement).map(([key, count]) => `${count} ${key}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

interface ScoredStory {
  story: Story;
  parsed: ParsedBriefBody;
  summary: string | null;
  llmScore: number | null;
  alsoIn: string[];
  score: number;
  why: string[];
}

function scoreStories(stories: Story[], now: Date): ScoredStory[] {
  const parsedStories = stories.map((story) => {
    // Signals may live on any copy: pipeline copies carry LLM summaries and
    // scores, cluster pipelines carry the cluster label.
    const parsedRows = story.rows.map((c) =>
      parseBriefBody(
        c.row.body,
        parseJsonStringArray(c.row.applied_transforms).includes("cluster"),
      ));
    const homeIndex = story.rows.indexOf(story.home);
    const homeParsed = parsedRows[homeIndex]!;
    const parsed: ParsedBriefBody = {
      ...homeParsed,
      keywordScore: parsedRows.find((p) => p.keywordScore)?.keywordScore ?? null,
      clusterLabel: parsedRows.find((p) => p.clusterLabel)?.clusterLabel ?? null,
      discussionUrl: homeParsed.discussionUrl ?? parsedRows.find((p) => p.discussionUrl)?.discussionUrl ?? null,
    };
    if (parsed.engagementScore === 0) {
      const withEngagement = parsedRows.find((p) => p.engagementScore > 0);
      if (withEngagement) {
        parsed.engagement = withEngagement.engagement;
        parsed.engagementScore = withEngagement.engagementScore;
      }
    }
    const llmSummary = story.rows.map((c) => c.row.summary).find((s) => s != null && s.trim() !== "");
    const scores = story.rows.map((c) => c.row.score).filter((s): s is number => s != null);
    const panelNames = [
      ...new Set(story.rows.map((c) => c.panel.panel.panel).filter((name) => name !== story.home.panel.panel.panel)),
    ];
    return {
      story,
      parsed,
      summary: llmSummary ? capBriefText(collapse(llmSummary)) : parsed.summary,
      llmScore: scores.length > 0 ? Math.max(...scores) : null,
      alsoIn: panelNames,
    };
  });

  const maxEngagement = Math.max(0, ...parsedStories.map((s) => s.parsed.engagementScore));
  return parsedStories.map((s) => {
    const published = s.story.home.row.timestamp;
    const engagementNorm = maxEngagement > 0
      ? Math.log1p(s.parsed.engagementScore) / Math.log1p(maxEngagement)
      : 0;
    const ageMs = Math.max(0, now.getTime() - timestampMs(published));
    const recency = Math.pow(2, -ageMs / BRIEF_RECENCY_HALF_LIFE_MS);
    const cross = Math.min(1, s.alsoIn.length / 2);
    const base = 0.4 * engagementNorm + 0.4 * recency + 0.2 * cross;
    const blended = s.llmScore === null ? base : 0.5 * (Math.min(10, Math.max(0, s.llmScore)) / 10) + 0.5 * base;

    const why: string[] = [];
    if (s.llmScore !== null) why.push(`llm-rank ${s.llmScore}/10`);
    const engagement = formatEngagement(s.parsed.engagement);
    if (engagement) why.push(engagement);
    if (s.parsed.keywordScore) {
      const terms = s.parsed.keywordScore.terms;
      why.push(`keyword-score ${s.parsed.keywordScore.score}${terms ? ` (${terms})` : ""}`);
    }
    if (s.parsed.clusterLabel) why.push(`clustered with related stories: ${s.parsed.clusterLabel}`);
    if (s.alsoIn.length > 0) why.push(`also in ${s.alsoIn.join(", ")}`);
    why.push(`published ${formatBriefAge(published, now)} ago`);

    return { ...s, score: Math.round(blended * 100), why };
  });
}

function compareScored(a: ScoredStory, b: ScoredStory): number {
  return (
    b.score - a.score ||
    timestampMs(b.story.home.row.timestamp) - timestampMs(a.story.home.row.timestamp) ||
    (a.story.home.row.id < b.story.home.row.id ? -1 : a.story.home.row.id > b.story.home.row.id ? 1 : 0)
  );
}

/**
 * Order one panel's stories for picking: best score first, but once a source
 * has BRIEF_SOURCE_SOFT_CAP picks, its remaining items wait until every other
 * source in the panel has had its turn (a release panel should not be eight
 * nightly builds of one repo).
 */
function diversifyBySource(stories: ScoredStory[]): ScoredStory[] {
  const sorted = [...stories].sort(compareScored);
  const first: ScoredStory[] = [];
  const deferred: ScoredStory[] = [];
  const perSource = new Map<string, number>();
  for (const story of sorted) {
    const source = story.story.home.row.source;
    const count = perSource.get(source) ?? 0;
    perSource.set(source, count + 1);
    (count < BRIEF_SOURCE_SOFT_CAP ? first : deferred).push(story);
  }
  return [...first, ...deferred];
}

/** Rough token count for a rendering: characters / 4, rounded up. */
export function estimateBriefTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build the brief from the stored database. `now` pins generated_at, the
 * since cutoff's reference, and the recency signal so a brief is
 * reproducible for a fixed database and clock.
 */
export function buildBrief(ctx: BriefContext, options: BriefOptions, now = new Date()): BriefDocument {
  const explicit = options.panelIds !== undefined;
  const scopePanels: DashboardPanel[] = [];
  const skippedPanels: string[] = [];
  const panelsInLayout = ctx.dashboardPanels;
  if (explicit) {
    for (const id of options.panelIds!) {
      const panel = panelsInLayout.find((p) => p.pid === id);
      if (panel) scopePanels.push(panel);
    }
    // Keep layout order for sections regardless of the filter's order.
    scopePanels.sort((a, b) => panelsInLayout.indexOf(a) - panelsInLayout.indexOf(b));
  } else {
    for (const panel of panelsInLayout) {
      if (isNonFeedPanel(panel, ctx)) skippedPanels.push(panel.pid);
      else scopePanels.push(panel);
    }
  }

  const cutoffMs = options.since.cutoff?.getTime() ?? null;
  const panelStats = new Map<string, BriefPanel>();
  const stories: Story[] = [];
  const byUrl = new Map<string, Story>();
  const byTitle = new Map<string, Story>();
  let candidates = 0;
  let olderThanWindow = 0;
  let inWindow = 0;

  for (const panel of scopePanels) {
    const kind = panelKind(panel, ctx);
    const snapshot = loadDashboardPanelData(
      panel.pid,
      panel.isAll,
      panel.panel.limit ?? DEFAULT_PANEL_LIMIT,
    );
    const stats: BriefPanel = {
      id: panel.pid,
      name: panel.panel.panel,
      kind,
      last_refreshed_at: toApiTimestamp(snapshot.lastRefreshedAt),
      candidates: snapshot.items.length,
      older_than_window: 0,
      listed_elsewhere: 0,
      selected: 0,
    };
    panelStats.set(panel.pid, stats);
    candidates += snapshot.items.length;

    const layoutIndex = panelsInLayout.indexOf(panel);
    for (const row of snapshot.items) {
      // Source-all panels span every stored panel, reference panels included.
      if (skippedPanels.includes(row.panel_id)) {
        stats.candidates--;
        candidates--;
        continue;
      }
      if (cutoffMs !== null && timestampMs(row.timestamp) < cutoffMs) {
        stats.older_than_window++;
        olderThanWindow++;
        continue;
      }
      inWindow++;
      const candidate: Candidate = { row, panel, kind, layoutIndex };
      const urlKey = itemSeenKey(row);
      const titleKey = titleDedupKey(row.title);
      const existing = byUrl.get(urlKey) ?? (titleKey !== null ? byTitle.get(titleKey) : undefined);
      if (existing) {
        existing.rows.push(candidate);
        if (prefersAsHome(candidate, existing.home)) existing.home = candidate;
        byUrl.set(urlKey, existing);
        if (titleKey !== null && !byTitle.has(titleKey)) byTitle.set(titleKey, existing);
        continue;
      }
      const story: Story = { key: urlKey, titleKey, home: candidate, rows: [candidate] };
      stories.push(story);
      byUrl.set(urlKey, story);
      if (titleKey !== null) byTitle.set(titleKey, story);
    }
  }

  const scored = scoreStories(stories, now);
  for (const s of scored) {
    // A story counts as listed elsewhere in every non-home panel it appeared in.
    for (const c of s.story.rows) {
      if (c.panel.pid !== s.story.home.panel.pid) panelStats.get(c.panel.pid)!.listed_elsewhere++;
    }
  }

  // Round-robin across panels in layout order so one busy panel cannot crowd
  // out the rest; each panel contributes its best remaining story per round.
  const queues = new Map<string, ScoredStory[]>(
    scopePanels.map((panel) => [
      panel.pid,
      diversifyBySource(scored.filter((s) => s.story.home.panel.pid === panel.pid)),
    ]),
  );
  const picked = new Map<string, ScoredStory[]>(scopePanels.map((panel) => [panel.pid, []]));
  let total = 0;
  let progressed = true;
  while (total < options.limit && progressed) {
    progressed = false;
    for (const panel of scopePanels) {
      if (total >= options.limit) break;
      const list = picked.get(panel.pid)!;
      const queue = queues.get(panel.pid)!;
      if (list.length >= options.perPanel || queue.length === 0) continue;
      list.push(queue.shift()!);
      total++;
      progressed = true;
    }
  }

  const items: BriefItem[] = [];
  for (const panel of scopePanels) {
    // Source diversity decided WHICH stories made the cut; within the
    // section they read best-first.
    const list = picked.get(panel.pid)!.sort(compareScored);
    panelStats.get(panel.pid)!.selected = list.length;
    for (const s of list) {
      const row = s.story.home.row;
      items.push({
        n: items.length + 1,
        id: row.id,
        title: collapse(row.title),
        url: row.url,
        source: row.source,
        panel: panel.pid,
        panel_name: panel.panel.panel,
        also_in: s.alsoIn,
        score: s.score,
        llm_score: s.llmScore,
        engagement: s.parsed.engagement,
        summary: s.summary,
        why_ranked: s.why,
        published_at: toApiTimestamp(row.timestamp),
        fetched_at: toApiTimestamp(row.fetched_at),
        discussion_url: s.parsed.discussionUrl,
      });
    }
  }

  const doc: BriefDocument = {
    schema: BRIEF_SCHEMA,
    generated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    config: ctx.configLabel,
    scope: {
      panels: scopePanels.map((panel) => panel.pid),
      skipped_panels: skippedPanels,
      since: options.since.cutoff ? options.since.cutoff.toISOString().replace(/\.\d{3}Z$/, "Z") : null,
      window: options.since.label,
      limit: options.limit,
      per_panel: options.perPanel,
    },
    counts: {
      panels: scopePanels.length,
      candidates,
      older_than_window: olderThanWindow,
      duplicates_merged: inWindow - stories.length,
      selected: items.length,
      cut_by_limits: stories.length - items.length,
    },
    token_estimate: { method: "chars/4", markdown: 0, json: 0 },
    panels: scopePanels.map((panel) => panelStats.get(panel.pid)!),
    items,
  };
  // Each estimate is measured on a rendering that already contains it, so run
  // twice; any leftover digit drift is far inside a chars/4 estimate.
  for (let pass = 0; pass < 2; pass++) {
    doc.token_estimate.markdown = estimateBriefTokens(renderBriefMarkdown(doc, ctx));
    doc.token_estimate.json = estimateBriefTokens(renderBriefJson(doc));
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderBriefJson(doc: BriefDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Keep text on one line and stop Markdown renderers reading "<x>" as HTML. */
function mdText(text: string): string {
  return collapse(text).replace(/</g, "\\<");
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * Markdown for one LLM read: a short header (what, when, how much), then one
 * section per panel with [n]-numbered items. Nothing here is HTML.
 */
export function renderBriefMarkdown(
  doc: BriefDocument,
  ctx?: Pick<BriefContext, "dashboardPanels">,
): string {
  const now = new Date(doc.generated_at);
  const nameOf = (id: string): string =>
    ctx?.dashboardPanels.find((p) => p.pid === id)?.panel.panel ?? id;
  const window = doc.scope.since === null
    ? "all stored items"
    : doc.scope.window.startsWith("since ")
      ? `items ${doc.scope.window}`
      : `items from the last ${doc.scope.window} (since ${doc.scope.since})`;
  const lines: string[] = [
    `# Pace brief: ${mdText(doc.config)}`,
    "",
    `Generated ${doc.generated_at}. Window: ${window}.`,
    `${plural(doc.counts.selected, "item")} from ${plural(doc.counts.panels, "panel")}; ` +
      `${doc.counts.candidates} candidates, ${doc.counts.older_than_window} older than the window, ` +
      `${doc.counts.duplicates_merged} duplicates merged, ${doc.counts.cut_by_limits} cut by limits. ` +
      `About ${doc.token_estimate.markdown} tokens.`,
  ];
  if (doc.scope.skipped_panels.length > 0) {
    lines.push(`Skipped reference panels: ${doc.scope.skipped_panels.map((id) => mdText(nameOf(id))).join(", ")}.`);
  }
  lines.push(
    `Items are numbered [n] across the whole brief; cite them as [n] with the URL. ` +
      `Scores run 0-100 and only compare items within this brief. Schema ${doc.schema}.`,
  );

  for (const panel of doc.panels) {
    lines.push("", `## ${mdText(panel.name)}`, "");
    const items = doc.items.filter((item) => item.panel === panel.id);
    if (items.length === 0) {
      const reasons: string[] = [];
      if (panel.listed_elsewhere > 0) reasons.push(`${panel.listed_elsewhere} listed under other panels`);
      if (panel.older_than_window > 0) reasons.push(`${panel.older_than_window} older than the window`);
      if (panel.candidates === 0) reasons.push("no stored items yet");
      lines.push(`Nothing new here${reasons.length > 0 ? ` (${reasons.join(", ")})` : ""}.`);
      continue;
    }
    for (const item of items) {
      lines.push(`- [${item.n}] ${mdText(item.title)}`);
      const meta = [item.url || "(no url)", mdText(item.source), `${formatBriefAge(item.published_at, now)} ago`, `score ${item.score}`];
      lines.push(`  ${meta.join(" · ")}`);
      const why = item.why_ranked.filter((w) => !w.startsWith("published "));
      if (why.length > 0) lines.push(`  why: ${mdText(why.join("; "))}`);
      if (item.discussion_url && item.discussion_url !== item.url) {
        lines.push(`  discussion: ${item.discussion_url}`);
      }
      if (item.summary) lines.push(`  ${mdText(item.summary)}`);
    }
  }
  return lines.join("\n") + "\n";
}

/** Stderr summary line for the CLI. */
export function formatBriefSummary(doc: BriefDocument, format: "json" | "markdown"): string {
  const tokens = format === "json" ? doc.token_estimate.json : doc.token_estimate.markdown;
  return `brief: ${plural(doc.counts.selected, "item")} from ${plural(doc.counts.panels, "panel")}, about ${tokens} tokens (${format})`;
}
