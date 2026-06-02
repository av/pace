import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AdapterConfig } from "./adapters/types";
import { errorMessage, getAdapterName } from "./utils";

export interface FlexContainerConfig {
  direction: "row" | "column";
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

export interface SourceConfig {
  adapter: string;
  params?: Record<string, unknown>;
}

export interface KeywordScoreEntry {
  term: string;
  weight: number;
  regex?: boolean;
}

/** Fields keyword filter/exclude transforms may match against. */
export type KeywordField = "title" | "body" | "source";

export const KEYWORD_FIELDS: readonly KeywordField[] = ["title", "body", "source"];

export type TransformConfig =
  | { type: "latest"; count: number }
  | { type: "filter"; keywords: string[]; fields?: KeywordField[] }
  | { type: "exclude"; keywords: string[]; fields?: KeywordField[] }
  | { type: "sort"; field: "timestamp" | "title" | "source"; direction?: "asc" | "desc" }
  | { type: "dedupe"; strategy?: "url" | "domain-normalized" | "title-similarity"; threshold?: number; keep?: "highest-score" | "earliest" | "latest"; log?: boolean }
  | { type: "keyword-score"; keywords: KeywordScoreEntry[]; min_score?: number; annotate?: boolean }
  | { type: "time-decay"; half_life?: string; engagement_weight?: number; recency_weight?: number; decay?: "exponential" | "linear"; annotate?: boolean; min_score?: number }
  | { type: "cluster"; strategy?: "domain" | "keywords" | "source" | "auto"; min_cluster_size?: number; max_clusters?: number; similarity_threshold?: number; annotate?: boolean }
  | { type: "llm-summarize" }
  | { type: "llm-filter"; criteria: string }
  | { type: "llm-rank"; interests?: string[] }
  | { type: "llm-merge"; prompt?: string };

export interface LlmConfig {
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
  interests?: string[];
}

export interface IngestAdapterConfig extends AdapterConfig {
  name?: string;
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

function resolveEnvVars(value: string, depth = 0): string {
  if (depth > 10) throw new Error(`config: too many recursive env var expansions (possible cycle) at depth ${depth}`);
  const replaced = value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
  if (replaced === value || !replaced.includes("${")) return replaced;
  return resolveEnvVars(replaced, depth + 1);
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

function isRecord(value: unknown): value is Record<string, unknown> {
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

function validateAllowedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  message: (key: string) => string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new Error(`config: ${message(key)}`);
    }
  }
}

function validateSource(source: unknown, path: string): void {
  if (typeof source === "string") {
    validateNonEmptyString(source, path);
    return;
  }

  if (Array.isArray(source)) {
    validateNonEmptyArray(source, path);
    source.forEach((entry, index) => validateSource(entry, `${path}[${index}]`));
    return;
  }

  if (!isRecord(source)) {
    throw new Error(`config: ${path} must be a source name or source object`);
  }

  validateNonEmptyString(source.adapter, `${path}.adapter`);
  if (source.params !== undefined && !isRecord(source.params)) {
    throw new Error(`config: ${path}.params must be an object`);
  }
  validateAllowedKeys(source, ["adapter", "params"], (key) =>
    `${path}.${key} is not a valid source field (set refresh_interval on adapters[], not panel source)`,
  );
}

function validateLayoutNode(node: unknown, path = "layout"): asserts node is LayoutNodeConfig {
  if (!isRecord(node)) {
    throw new Error(`config: ${path} must be a layout node object`);
  }

  const hasPanel = "panel" in node;
  const hasContainer = "direction" in node || "children" in node;

  if (hasPanel && hasContainer) {
    throw new Error(`config: ${path} cannot be both a panel and a container`);
  }

  if (hasPanel) {
    validateNonEmptyString(node.panel, `${path}.panel`);
    if (!("source" in node)) {
      throw new Error(`config: ${path}.source is required`);
    }
    validateSource(node.source, `${path}.source`);
    return;
  }

  if (!hasContainer) {
    throw new Error(`config: ${path} must define either panel or direction/children`);
  }

  if (node.direction !== "row" && node.direction !== "column") {
    throw new Error(`config: ${path}.direction must be "row" or "column"`);
  }

  if (!Array.isArray(node.children)) {
    throw new Error(`config: ${path}.children must be a list`);
  }

  node.children.forEach((child, index) => validateLayoutNode(child, `${path}.children[${index}]`));
}

function validatePanelIds(node: LayoutNodeConfig): void {
  const panels = collectPanels(node);
  const names = new Set<string>();
  for (const p of panels) {
    if (names.has(p.panel)) {
      throw new Error(`config: duplicate panel name "${p.panel}"`);
    }
    names.add(p.panel);
  }
  const idToPanels = new Map<string, string[]>();
  for (const p of panels) {
    const id = resolvePanelId(p);
    const list = idToPanels.get(id) ?? [];
    list.push(p.panel);
    idToPanels.set(id, list);
    if (list.length > 1) {
      throw new Error(`config: duplicate panel ID "${id}" (panels: "${list.join('", "')}")`);
    }
  }
}

function validatePositiveNumber(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`config: ${path} must be a positive number`);
  }
}

function validatePositiveInteger(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`config: ${path} must be a positive integer`);
  }
}

function validateFiniteNumber(value: unknown, path: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`config: ${path} must be a number`);
  }
}

function validateOptional(value: unknown, path: string, validator: (v: unknown, p: string) => void): void {
  if (value !== undefined) {
    validator(value, path);
  }
}

function validateOptionalPositiveNumber(value: unknown, path: string): void {
  validateOptional(value, path, validatePositiveNumber);
}

function validateOptionalPositiveInteger(value: unknown, path: string): void {
  validateOptional(value, path, validatePositiveInteger);
}

function validateOptionalFiniteNumber(value: unknown, path: string): void {
  validateOptional(value, path, validateFiniteNumber);
}

function validateOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`config: ${path} must be a boolean`);
  }
}

function validateOptionalNonEmptyString(value: unknown, path: string): void {
  validateOptional(value, path, validateNonEmptyString);
}

function validateNonEmptyString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`config: ${path} must be a non-empty string`);
  }
}

function validateNonEmptyArray(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${path} must be a list`);
  }
  if (value.length === 0) {
    throw new Error(`config: ${path} must not be empty`);
  }
}

function validateOptionalList(value: unknown, path: string): void {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`config: ${path} must be a list`);
  }
}

function validateStringList(value: unknown, path: string): void {
  validateNonEmptyArray(value, path);
  value.forEach((entry, index) => {
    validateNonEmptyString(entry, `${path}[${index}]`);
  });
}

function validateOptionalStringList(value: unknown, path: string): void {
  if (value !== undefined) {
    validateStringList(value, path);
  }
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): void {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`config: ${path} must be one of: ${allowed.join(", ")}`);
  }
}

function validateOptionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): void {
  if (value !== undefined) {
    validateEnum(value, allowed, path);
  }
}

function validateOptionalUnitNumber(value: unknown, path: string): void {
  if (value === undefined) return;
  validateFiniteNumber(value, path);
  if ((value as number) < 0 || (value as number) > 1) {
    throw new Error(`config: ${path} must be between 0 and 1`);
  }
}

function validateKeywordScoreEntries(value: unknown, path: string): void {
  validateNonEmptyArray(value, path);

  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`config: ${entryPath} must be an object`);
    }
    validateNonEmptyString(entry.term, `${entryPath}.term`);
    validateFiniteNumber(entry.weight, `${entryPath}.weight`);
    validateOptionalBoolean(entry.regex, `${entryPath}.regex`);
  });
}

function validateTransform(transform: Record<string, unknown>, path: string): void {
  switch (transform.type) {
    case "latest":
      validatePositiveInteger(transform.count, `${path}.count`);
      break;
    case "filter":
    case "exclude":
      validateStringList(transform.keywords, `${path}.keywords`);
      if (transform.fields !== undefined) {
        validateNonEmptyArray(transform.fields, `${path}.fields`);
        transform.fields.forEach((field, fieldIndex) =>
          validateEnum(field, KEYWORD_FIELDS, `${path}.fields[${fieldIndex}]`)
        );
      }
      break;
    case "sort":
      validateEnum(transform.field, ["timestamp", "title", "source"], `${path}.field`);
      validateOptionalEnum(transform.direction, ["asc", "desc"], `${path}.direction`);
      break;
    case "dedupe":
      validateOptionalEnum(
        transform.strategy,
        ["url", "domain-normalized", "title-similarity"],
        `${path}.strategy`,
      );
      validateOptionalUnitNumber(transform.threshold, `${path}.threshold`);
      validateOptionalEnum(transform.keep, ["highest-score", "earliest", "latest"], `${path}.keep`);
      validateOptionalBoolean(transform.log, `${path}.log`);
      break;
    case "keyword-score":
      validateKeywordScoreEntries(transform.keywords, `${path}.keywords`);
      validateOptionalFiniteNumber(transform.min_score, `${path}.min_score`);
      validateOptionalBoolean(transform.annotate, `${path}.annotate`);
      break;
    case "time-decay":
      validateOptionalNonEmptyString(transform.half_life, `${path}.half_life`);
      validateOptionalFiniteNumber(transform.engagement_weight, `${path}.engagement_weight`);
      validateOptionalFiniteNumber(transform.recency_weight, `${path}.recency_weight`);
      validateOptionalEnum(transform.decay, ["exponential", "linear"], `${path}.decay`);
      validateOptionalBoolean(transform.annotate, `${path}.annotate`);
      validateOptionalFiniteNumber(transform.min_score, `${path}.min_score`);
      break;
    case "cluster":
      validateOptionalEnum(transform.strategy, ["domain", "keywords", "source", "auto"], `${path}.strategy`);
      validateOptionalPositiveInteger(transform.min_cluster_size, `${path}.min_cluster_size`);
      validateOptionalPositiveInteger(transform.max_clusters, `${path}.max_clusters`);
      validateOptionalUnitNumber(transform.similarity_threshold, `${path}.similarity_threshold`);
      validateOptionalBoolean(transform.annotate, `${path}.annotate`);
      break;
    case "llm-summarize":
      break;
    case "llm-filter":
      validateOptionalNonEmptyString(transform.criteria, `${path}.criteria`);
      if (transform.criteria === undefined) {
        throw new Error(`config: ${path}.criteria is required`);
      }
      break;
    case "llm-rank":
      validateOptionalStringList(transform.interests, `${path}.interests`);
      break;
    case "llm-merge":
      validateOptionalNonEmptyString(transform.prompt, `${path}.prompt`);
      break;
    default:
      throw new Error(`config: ${path}.type references unknown transform "${transform.type}"`);
  }
}

function validateTransforms(transforms: unknown, path: string): asserts transforms is TransformConfig[] {
  if (!Array.isArray(transforms)) {
    throw new Error(`config: ${path} must be a list`);
  }

  transforms.forEach((transform, index) => {
    if (!isRecord(transform)) {
      throw new Error(`config: ${path}[${index}] must be an object`);
    }
    validateNonEmptyString(transform.type, `${path}[${index}].type`);
    validateTransform(transform, `${path}[${index}]`);
  });
}

function validateLlmConfig(llm: unknown): asserts llm is LlmConfig | undefined {
  if (llm === undefined) return;
  if (!isRecord(llm)) {
    throw new Error("config: llm must be an object");
  }

  const LLM_CONFIG_FIELDS = ["provider", "model", "api_key", "base_url"] as const;
  LLM_CONFIG_FIELDS.forEach((key) => {
    validateOptionalNonEmptyString(llm[key], `llm.${key}`);
  });
  validateOptionalStringList(llm.interests, "llm.interests");

  const configuredFields = ["provider", "model", "api_key"].filter((key) => llm[key] !== undefined);
  if (configuredFields.length > 0 && configuredFields.length < 3) {
    throw new Error("config: llm.provider, llm.model, and llm.api_key must be set together");
  }
}

function validateTopLevelKeys(config: Record<string, unknown>): void {
  validateAllowedKeys(config, ["adapters", "pipelines", "layout", "llm"], (key) =>
    `unknown top-level key "${key}"`,
  );
}

function validatePanelSourceRefs(layout: LayoutNodeConfig, sourceNames: Set<string>): void {
  for (const panel of collectPanels(layout)) {
    const sources = normalizeSource(panel.source);
    sources.forEach((source, index) => {
      if (source.adapter === "all") return;
      if (!sourceNames.has(source.adapter)) {
        const sourcePath = sources.length === 1
          ? `layout panel "${panel.panel}" source`
          : `layout panel "${panel.panel}" source[${index}]`;
        throw new Error(`config: ${sourcePath} references unknown source "${source.adapter}"`);
      }
    });
  }
}

function validateAdapterConfig(adapter: unknown, index: number): asserts adapter is IngestAdapterConfig {
  const path = `adapters[${index}]`;
  if (!isRecord(adapter)) {
    throw new Error(`config: ${path} must be an object`);
  }
  validateAllowedKeys(adapter, ["type", "name", "params", "refresh_interval", "transforms"], (key) =>
    `${path}.${key} is not a valid adapter field`,
  );
  validateNonEmptyString(adapter.type, `${path}.type`);
  validateOptionalNonEmptyString(adapter.name, `${path}.name`);
  if (adapter.params !== undefined && !isRecord(adapter.params)) {
    throw new Error(`config: ${path}.params must be an object`);
  }
  validateOptionalPositiveNumber(adapter.refresh_interval, `${path}.refresh_interval`);
  if (adapter.transforms !== undefined) {
    validateTransforms(adapter.transforms, `${path}.transforms`);
  }
}

function validatePipelineConfig(
  pipeline: unknown,
  index: number,
  sourceNames: Set<string>,
): asserts pipeline is PipelineConfig {
  const path = `pipelines[${index}]`;
  if (!isRecord(pipeline)) {
    throw new Error(`config: ${path} must be an object`);
  }
  validateAllowedKeys(pipeline, ["name", "sources", "transforms", "refresh_interval"], (key) =>
    `${path}.${key} is not a valid pipeline field`,
  );
  validateNonEmptyString(pipeline.name, `${path}.name`);
  validateNonEmptyArray(pipeline.sources, `${path}.sources`);

  const seenSources = new Set<string>();
  pipeline.sources.forEach((source, sourceIndex) => {
    const sourcePath = `${path}.sources[${sourceIndex}]`;
    validateNonEmptyString(source, sourcePath);
    if (seenSources.has(source)) {
      throw new Error(`config: ${sourcePath} duplicates source "${source}"`);
    }
    if (!sourceNames.has(source)) {
      throw new Error(`config: ${sourcePath} references unknown source "${source}"`);
    }
    seenSources.add(source);
  });

  validateTransforms(pipeline.transforms, `${path}.transforms`);
  validateOptionalPositiveNumber(pipeline.refresh_interval, `${path}.refresh_interval`);
}

export function tryReadRegularFile(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  const st = statSync(path);
  if (!st.isFile()) {
    throw new Error(`config: ${path} is not a regular file`);
  }
  return readFileSync(path, "utf-8");
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

export function loadConfig(): AppConfig {
  let explicitConfigPath = process.env.PACE_CONFIG !== undefined;
  let configPath = process.env.PACE_CONFIG ?? join(process.cwd(), "config.yaml");

  if (process.env.PACE_CONFIG && !process.env.PACE_CONFIG.includes("/") && !process.env.PACE_CONFIG.includes("\\")) {
    const resolved = resolvePreset(process.env.PACE_CONFIG);
    if (resolved) {
      configPath = resolved;
      explicitConfigPath = true;
    }
  }

  const examplePath = join(process.cwd(), "config.example.yaml");

  let raw: string;
  let usedConfigPath: string;
  const configContent = tryReadRegularFile(configPath);
  if (configContent !== null) {
    usedConfigPath = configPath;
    raw = configContent;
  } else if (explicitConfigPath) {
    throw new Error(`config: file not found: ${configPath}`);
  } else {
    const exampleContent = tryReadRegularFile(examplePath);
    if (exampleContent !== null) {
      usedConfigPath = examplePath;
      raw = exampleContent;
    } else {
      return defaultConfig();
    }
  }

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

  validateLayoutNode(layout);
  validatePanelIds(layout);

  rawAdapters.forEach(validateAdapterConfig);
  const adapters = rawAdapters as IngestAdapterConfig[];

  const names = new Set<string>();
  for (const a of adapters) {
    const n = getAdapterName(a);
    if (names.has(n)) throw new Error(`config: duplicate adapter name "${n}"`);
    names.add(n);
  }

  const sourceNames = new Set(names);
  for (const [index, p] of rawPipelines.entries()) {
    validatePipelineConfig(p, index, sourceNames);
  }
  const pipelines = rawPipelines as PipelineConfig[];

  for (const p of pipelines) {
    if (names.has(p.name)) throw new Error(`config: duplicate pipeline/adapter name "${p.name}"`);
    names.add(p.name);
  }

  validatePanelSourceRefs(layout, names);
  validateLlmConfig(resolved.llm);

  return {
    adapters,
    pipelines: pipelines.length > 0 ? pipelines : undefined,
    layout,
    llm: resolved.llm as LlmConfig | undefined,
  };
}
