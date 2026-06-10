import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AdapterConfig } from "./adapters/types";
import { validateParsedConfig } from "./config-validate";
import { warnUnsetEnvVar } from "./config-warn";
import {
  KEYWORD_SCORE_ENTRY_FIELDS,
  TRANSFORM_FIELD_KEYS,
  TRANSFORM_TYPES,
  transformAllowedFieldKeys,
  type KeywordScoreEntryField,
  type TransformType,
} from "./transform-schema";
import { errorMessage } from "./utils";

export { KEYWORD_SCORE_ENTRY_FIELDS, TRANSFORM_FIELD_KEYS, TRANSFORM_TYPES, transformAllowedFieldKeys };
export type { KeywordScoreEntryField, TransformType };

export {
  LAYOUT_DIRECTIONS,
  allPanelRefreshSourceNames,
  buildLayoutRuntimeMaps,
  collectPanels,
  isContainer,
  isPanel,
  isRecord,
  normalizeSource,
  resolvePanelId,
  resolvePanelRefreshSourceNames,
} from "./layout/types";
export type {
  DashboardPanel,
  FlexContainerConfig,
  LayoutDirection,
  LayoutNodeConfig,
  LayoutRuntimeMaps,
  PanelConfig,
  SourceConfig,
  SourceValue,
} from "./layout/types";
import { isRecord, type LayoutNodeConfig } from "./layout/types";

export interface KeywordScoreEntry {
  term: string;
  weight: number;
  regex?: boolean;
}

type AssertKeywordScoreEntryFieldsAlign =
  keyof KeywordScoreEntry extends KeywordScoreEntryField
    ? KeywordScoreEntryField extends keyof KeywordScoreEntry
      ? true
      : ["KEYWORD_SCORE_ENTRY_FIELDS has extra fields"]
    : ["KeywordScoreEntry has extra fields"];

declare const _keywordScoreEntryFieldsDriftGuard: AssertKeywordScoreEntryFieldsAlign;

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

type TransformConfigFieldKeys<T extends TransformType> = Exclude<
  keyof Extract<TransformConfig, { type: T }>,
  "type"
>;

type TransformSchemaFieldKeys<T extends TransformType> = (typeof TRANSFORM_FIELD_KEYS)[T][number];

type AssertTransformFieldKeysAlign<T extends TransformType> =
  TransformConfigFieldKeys<T> extends TransformSchemaFieldKeys<T>
    ? TransformSchemaFieldKeys<T> extends TransformConfigFieldKeys<T>
      ? true
      : ["TRANSFORM_FIELD_KEYS has extra fields", T]
    : ["TransformConfig has extra fields", T];

type AssertTransformTypesMatch =
  TransformConfig["type"] extends TransformType
    ? TransformType extends TransformConfig["type"]
      ? true
      : ["TRANSFORM_FIELD_KEYS has extra transform type"]
    : ["TransformConfig has extra transform type"];

type AssertTransformSchemaDrift =
  AssertTransformTypesMatch extends true
    ? {
        [T in TransformType]: AssertTransformFieldKeysAlign<T> extends true
          ? true
          : AssertTransformFieldKeysAlign<T>;
      }[TransformType] extends true
      ? true
      : never
    : never;

declare const _transformSchemaDriftGuard: AssertTransformSchemaDrift;

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
  const { adapters, pipelines, layout, llm } = validateParsedConfig(resolved, DEFAULT_LAYOUT);

  return {
    adapters,
    pipelines: pipelines.length > 0 ? pipelines : undefined,
    layout,
    llm,
  };
}
