import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { validateParsedConfig } from "./config-validate";
import { warnUnsetEnvVar } from "./config-warn";
import {
  DEFAULT_LAYOUT,
  type AppConfig,
  type ConfigFileReader,
  type ConfigPathResolution,
  type ConfigReadResult,
} from "./config/domain";
import { isRecord } from "./config/types";
import { errorMessage } from "./utils";

export {
  CLUSTER_STRATEGIES,
  DECAY_TYPES,
  DEDUPE_DEFAULT_KEEP,
  DEDUPE_DEFAULT_STRATEGY,
  DEDUPE_DEFAULT_THRESHOLD,
  DEDUPE_KEEP_OPTIONS,
  DEDUPE_STRATEGIES,
  isDedupeStrategy,
  KEYWORD_FIELDS,
  KEYWORD_SCORE_ENTRY_FIELDS,
  SORT_DIRECTIONS,
  SORT_FIELDS,
  TRANSFORM_FIELD_KEYS,
  TRANSFORM_TYPES,
  transformAllowedFieldKeys,
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
} from "./config/types";
export type {
  AppConfig,
  ClusterStrategy,
  ConfigFileReader,
  ConfigPathResolution,
  ConfigReadResult,
  DashboardPanel,
  DecayType,
  DedupeKeep,
  DedupeStrategy,
  FlexContainerConfig,
  IngestAdapterConfig,
  KeywordField,
  KeywordScoreEntry,
  KeywordScoreEntryField,
  LayoutDirection,
  LayoutNodeConfig,
  LayoutRuntimeMaps,
  LlmConfig,
  PanelConfig,
  PipelineConfig,
  SortDirection,
  SortField,
  SourceConfig,
  SourceValue,
  TransformConfig,
  TransformType,
} from "./config/types";

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

const PRESET_NAMES = ["example", "daily-brief", "tech-news", "ml-ai", "product-launches", "release-tracker", "academic-papers", "video-podcast"] as const;

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