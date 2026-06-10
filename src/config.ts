import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AdapterConfig } from "./adapters/types";
import {
  validateAdapterConfig,
  validateLayout,
  validateLlmConfig,
  validateOptionalList,
  validatePipelineConfig,
  validateTopLevelKeys,
  validateUniqueStringList,
  validateUniqueUnnamedAdapterTypes,
  TRANSFORM_TYPES,
} from "./config-validate";
import { warnUnsetEnvVar } from "./config-warn";
import { errorMessage, getAdapterName } from "./utils";

export { TRANSFORM_TYPES };

export const LAYOUT_DIRECTIONS = ["row", "column"] as const;
export type LayoutDirection = (typeof LAYOUT_DIRECTIONS)[number];

export interface FlexContainerConfig {
  direction: LayoutDirection;
  flex?: number;
  gap?: string;
  children: LayoutNodeConfig[];
}

export interface PanelConfig {
  panel: string;
  id?: string;
  flex?: number;
  source: SourceValue;
  limit?: number;
}

export type LayoutNodeConfig = FlexContainerConfig | PanelConfig;

export type SourceValue = string | string[] | SourceConfig | SourceConfig[];

/** Layout panel source; only `adapter` and `params` (refresh_interval belongs on adapters[]). */
export interface SourceConfig {
  adapter: string;
  params?: Record<string, unknown>;
}

export interface KeywordScoreEntry {
  term: string;
  weight: number;
  regex?: boolean;
}

export type KeywordField = "title" | "body" | "source";

export const KEYWORD_FIELDS: readonly KeywordField[] = ["title", "body", "source"];

export const DEDUPE_STRATEGIES = ["url", "domain-normalized", "title-similarity"] as const;
export type DedupeStrategy = (typeof DEDUPE_STRATEGIES)[number];

export const DEDUPE_KEEP_OPTIONS = ["highest-score", "earliest", "latest"] as const;
export type DedupeKeep = (typeof DEDUPE_KEEP_OPTIONS)[number];

export const SORT_FIELDS = ["timestamp", "title", "source"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const DECAY_TYPES = ["exponential", "linear"] as const;
export type DecayType = (typeof DECAY_TYPES)[number];

export const CLUSTER_STRATEGIES = ["domain", "keywords", "source", "auto"] as const;
export type ClusterStrategy = (typeof CLUSTER_STRATEGIES)[number];

/** Runtime defaults for dedupe transform (must match apply logic in transforms.ts). */
export const DEDUPE_DEFAULT_STRATEGY: DedupeStrategy = "url";
export const DEDUPE_DEFAULT_THRESHOLD = 0.85;
export const DEDUPE_DEFAULT_KEEP: DedupeKeep = "highest-score";

export function isDedupeStrategy(value: string): value is DedupeStrategy {
  return (DEDUPE_STRATEGIES as readonly string[]).includes(value);
}

export type TransformConfig =
  | { type: "latest"; count: number }
  | { type: "filter"; keywords: string[]; fields?: KeywordField[] }
  | { type: "exclude"; keywords: string[]; fields?: KeywordField[] }
  | { type: "sort"; field: SortField; direction?: SortDirection }
  | { type: "dedupe"; strategy?: DedupeStrategy; threshold?: number; keep?: DedupeKeep; log?: boolean }
  | { type: "keyword-score"; keywords: KeywordScoreEntry[]; min_score?: number; annotate?: boolean }
  | { type: "time-decay"; half_life?: string; engagement_weight?: number; recency_weight?: number; decay?: DecayType; annotate?: boolean; min_score?: number }
  | { type: "cluster"; strategy?: ClusterStrategy; min_cluster_size?: number; max_clusters?: number; similarity_threshold?: number; annotate?: boolean }
  | { type: "llm-summarize" }
  | { type: "llm-filter"; criteria: string }
  | { type: "llm-rank"; interests?: string[] }
  | { type: "llm-merge"; prompt?: string };

export type TransformType = TransformConfig["type"];

export interface LlmConfig {
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
  interests?: string[];
}

export interface IngestAdapterConfig extends AdapterConfig {
  name?: string;
  /** Minutes between scheduled fetches (default 15, minimum 1); not read by `Adapter.fetch`. */
  refresh_interval?: number;
  transforms?: TransformConfig[];
}

export interface PipelineConfig {
  name: string;
  sources: string[];
  transforms: TransformConfig[];
  refresh_interval?: number;
}

export interface AppConfig {
  adapters: IngestAdapterConfig[];
  pipelines?: PipelineConfig[];
  layout: LayoutNodeConfig;
  llm?: LlmConfig;
}

const DEFAULT_LAYOUT: LayoutNodeConfig = {
  direction: "row",
  children: [{ panel: "all", source: "all", limit: 50 }],
};

function defaultConfig(): AppConfig {
  return {
    adapters: [],
    layout: DEFAULT_LAYOUT,
  };
}

const ENV_VAR_PLACEHOLDER = /\$\{(\w+)\}/g;
const LEFTOVER_ENV_PLACEHOLDER = /\$\{([^}]*)\}/g;
const MAX_ENV_EXPANSION_DEPTH = 10;

function assertEnvVarsFullyExpanded(value: string): void {
  const matches = [...value.matchAll(LEFTOVER_ENV_PLACEHOLDER)];
  if (matches.length === 0) return;
  const placeholders = [...new Set(matches.map((m) => m[0]))];
  const invalid = matches.find((m) => m[1] === "" || !/^\w+$/.test(m[1]));
  if (invalid) {
    const name = invalid[1];
    const detail =
      name === ""
        ? "empty name in ${}"
        : `invalid name "${name}" (use letters, digits, underscore only)`;
    throw new Error(`config: env var placeholder ${invalid[0]} has ${detail}`);
  }
  throw new Error(
    `config: unexpanded env var placeholder(s): ${placeholders.join(", ")} (check for a cyclic \${VAR} chain)`,
  );
}

function resolveEnvVars(value: string, depth = 0, warnedUnset = new Set<string>()): string {
  if (depth > MAX_ENV_EXPANSION_DEPTH) {
    const leftover = [...new Set([...value.matchAll(LEFTOVER_ENV_PLACEHOLDER)].map((m) => m[0]))];
    const hint = leftover.length ? `; still contains ${leftover.join(", ")}` : "";
    throw new Error(
      `config: env var expansion exceeded ${MAX_ENV_EXPANSION_DEPTH} passes (possible cycle)${hint}`,
    );
  }
  const replaced = value.replace(ENV_VAR_PLACEHOLDER, (_, name) => {
    const envValue = process.env[name];
    if (envValue === undefined) warnUnsetEnvVar(name, warnedUnset);
    return envValue ?? "";
  });
  if (replaced === value || !replaced.includes("${")) {
    assertEnvVarsFullyExpanded(replaced);
    return replaced;
  }
  return resolveEnvVars(replaced, depth + 1, warnedUnset);
}

function resolveEnvInObject(obj: unknown): unknown {
  if (typeof obj === "string") return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(resolveEnvInObject);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvInObject(value);
    }
    return result;
  }
  return obj;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPanel(node: unknown): node is PanelConfig {
  return isRecord(node) && "panel" in node;
}

export function isContainer(node: unknown): node is FlexContainerConfig {
  return isRecord(node) && "direction" in node && "children" in node;
}

export function normalizeSource(source: SourceValue): SourceConfig[] {
  if (typeof source === "string") {
    return [{ adapter: source }];
  }
  if (Array.isArray(source)) {
    return source.map((s) =>
      typeof s === "string" ? { adapter: s } : s
    );
  }
  return [source];
}

export function collectPanels(node: LayoutNodeConfig): PanelConfig[] {
  if (isPanel(node)) return [node];
  if (isContainer(node)) return node.children.flatMap(collectPanels);
  throw new Error("config: layout node is invalid");
}

export function resolvePanelId(panel: PanelConfig): string {
  if (panel.id) return panel.id;
  const key = JSON.stringify({ panel: panel.panel, source: panel.source, limit: panel.limit ?? null });
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(key);
  return hasher.digest("hex").slice(0, 8);
}

export interface DashboardPanel {
  panel: PanelConfig;
  pid: string;
  isAll: boolean;
}

export interface LayoutRuntimeMaps {
  sourceToPanels: Map<string, string[]>;
  sourceToReadKey: Map<string, string>;
  panelIdToSources: Map<string, SourceConfig[]>;
  panelIdToRefreshSourceNames: Map<string, string[]>;
  panelNameToId: Map<string, string>;
  dashboardPanels: DashboardPanel[];
}

export function allPanelRefreshSourceNames(
  adapterNames: readonly string[],
  pipelines: readonly { name: string }[] | undefined,
): string[] {
  const names = [...adapterNames];
  if (pipelines) {
    for (const pipeline of pipelines) names.push(pipeline.name);
  }
  return names;
}

export function resolvePanelRefreshSourceNames(
  sources: readonly { adapter: string }[],
  adapterNames: readonly string[],
  pipelines: readonly { name: string }[] | undefined,
): string[] {
  return [
    ...new Set(
      sources.flatMap((source) =>
        source.adapter === "all"
          ? allPanelRefreshSourceNames(adapterNames, pipelines)
          : [source.adapter],
      ),
    ),
  ];
}

export function buildLayoutRuntimeMaps(
  layout: LayoutNodeConfig,
  adapterNames: readonly string[],
  pipelines?: readonly { name: string }[],
): LayoutRuntimeMaps {
  const sourceToPanels = new Map<string, string[]>();
  const sourceToReadKey = new Map<string, string>();
  const panelIdToSources = new Map<string, SourceConfig[]>();
  const panelIdToRefreshSourceNames = new Map<string, string[]>();
  const panelNameToId = new Map<string, string>();
  const dashboardPanels: DashboardPanel[] = [];

  for (const panel of collectPanels(layout)) {
    const sources = normalizeSource(panel.source);
    const pid = resolvePanelId(panel);
    const isAll = sources.some((s) => s.adapter === "all");
    panelIdToSources.set(pid, sources);
    panelIdToRefreshSourceNames.set(
      pid,
      resolvePanelRefreshSourceNames(sources, adapterNames, pipelines),
    );
    panelNameToId.set(panel.panel, pid);
    dashboardPanels.push({ panel, pid, isAll });
    if (isAll) continue;
    for (const source of sources) {
      const list = sourceToPanels.get(source.adapter) ?? [];
      list.push(pid);
      sourceToPanels.set(source.adapter, list);
      if (!sourceToReadKey.has(source.adapter)) {
        sourceToReadKey.set(source.adapter, pid);
      }
    }
  }

  for (const name of adapterNames) {
    if (!sourceToPanels.has(name)) {
      sourceToPanels.set(name, [name]);
      sourceToReadKey.set(name, name);
    }
  }

  return {
    sourceToPanels,
    sourceToReadKey,
    panelIdToSources,
    panelIdToRefreshSourceNames,
    panelNameToId,
    dashboardPanels,
  };
}

export function tryReadRegularFile(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  const st = statSync(path);
  if (!st.isFile()) {
    throw new Error(`config: ${path} is not a regular file`);
  }
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`config: failed to read ${path}: ${errorMessage(err)}`);
  }
}

const PRESET_NAMES = ["example", "tech-news", "ml-ai", "product-launches", "release-tracker", "academic-papers", "video-podcast"] as const;

export function resolvePreset(name: string): string | null {
  if (!name || name.includes("/") || name.includes("\\")) return null;
  if (!(PRESET_NAMES as readonly string[]).includes(name)) return null;
  const candidates = [
    `/app/presets/config.${name}.yaml`,
    join(process.cwd(), `config.${name}.yaml`),
  ];
  for (const p of candidates) {
    if (tryReadRegularFile(p)) return p;
  }
  return null;
}

export function listPresets(): string[] {
  return [...PRESET_NAMES];
}

export interface ConfigPathResolution {
  path: string;
  explicit: boolean;
}

/** Resolve PACE_CONFIG (or defaults) to a filesystem path and whether it was explicitly requested. */
export function resolveConfigPath(paceConfig?: string): ConfigPathResolution {
  let explicit = paceConfig !== undefined;
  let path = paceConfig ?? join(process.cwd(), "config.yaml");

  if (paceConfig && !paceConfig.includes("/") && !paceConfig.includes("\\")) {
    const resolved = resolvePreset(paceConfig);
    if (resolved) {
      path = resolved;
      explicit = true;
    }
  }

  return { path, explicit };
}

export function configFileNotFoundError(path: string): string {
  return `config: file not found: ${path}`;
}

export interface ConfigReadResult {
  raw: string;
  usedConfigPath: string;
}

export type ConfigFileReader = (path: string) => string | null;

/** Read config YAML from a resolved path; falls back to config.example.yaml when implicit. */
export function readConfigSource(
  resolution: ConfigPathResolution,
  readFile: ConfigFileReader = tryReadRegularFile,
): ConfigReadResult | null {
  const content = readFile(resolution.path);
  if (content !== null) {
    return { raw: content, usedConfigPath: resolution.path };
  }
  if (resolution.explicit) {
    throw new Error(configFileNotFoundError(resolution.path));
  }

  const examplePath = join(process.cwd(), "config.example.yaml");
  const exampleContent = readFile(examplePath);
  if (exampleContent !== null) {
    return { raw: exampleContent, usedConfigPath: examplePath };
  }
  return null;
}

export function loadConfig(): AppConfig {
  const read = readConfigSource(resolveConfigPath(process.env.PACE_CONFIG));
  if (read === null) {
    return defaultConfig();
  }
  const { raw, usedConfigPath } = read;

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (err) {
    const reason = errorMessage(err).split("\n")[0];
    throw new Error(`config: failed to parse YAML from ${usedConfigPath}: ${reason}`);
  }

  if (parsed === undefined) {
    return defaultConfig();
  }
  if (!isRecord(parsed)) {
    throw new Error("config: top-level config must be an object");
  }

  const resolved = resolveEnvInObject(parsed) as Record<string, unknown>;
  validateTopLevelKeys(resolved);
  validateOptionalList(resolved.adapters, "adapters");
  validateOptionalList(resolved.pipelines, "pipelines");

  const rawAdapters = (resolved.adapters ?? []) as unknown[];
  const rawPipelines = (resolved.pipelines ?? []) as unknown[];
  const layout = resolved.layout ?? DEFAULT_LAYOUT;

  rawAdapters.forEach(validateAdapterConfig);
  const adapters = rawAdapters as IngestAdapterConfig[];

  validateUniqueUnnamedAdapterTypes(adapters);

  const adapterNames = adapters.map(getAdapterName);
  if (adapterNames.length > 0) {
    validateUniqueStringList(adapterNames, "adapters", undefined, "adapter name");
  }
  const names = new Set(adapterNames);

  const sourceNames = new Set(names);
  for (const [index, p] of rawPipelines.entries()) {
    validatePipelineConfig(p, index, sourceNames);
  }
  const pipelines = rawPipelines as PipelineConfig[];

  const pipelineNames = pipelines.map((p) => p.name);
  if (pipelineNames.length > 0) {
    validateUniqueStringList(pipelineNames, "pipelines", undefined, "pipeline name");
  }
  for (const p of pipelines) {
    if (names.has(p.name)) {
      throw new Error(`config: duplicate pipeline/adapter name "${p.name}"`);
    }
    names.add(p.name);
  }

  validateLayout(layout, names);
  validateLlmConfig(resolved.llm);

  return {
    adapters,
    pipelines: pipelines.length > 0 ? pipelines : undefined,
    layout,
    llm: resolved.llm as LlmConfig | undefined,
  };
}
