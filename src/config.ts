import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AdapterConfig } from "./adapters/types";

// --- Layout Tree ---

export interface FlexContainerConfig {
  direction: "row" | "column";
  flex?: number;
  gap?: string;
  children: LayoutNodeConfig[];
}

export interface PanelConfig {
  panel: string;
  flex?: number;
  source: SourceValue;
  limit?: number;
}

export type LayoutNodeConfig = FlexContainerConfig | PanelConfig;

// --- Sources ---

export type SourceValue = string | string[] | SourceConfig | SourceConfig[];

export interface SourceConfig {
  adapter: string;
  params?: Record<string, unknown>;
  refresh_interval?: number;
}

// --- Transforms ---

export interface KeywordScoreEntry {
  term: string;
  weight: number;
  regex?: boolean;
}

export type TransformConfig =
  | { type: "latest"; count: number }
  | { type: "filter"; keywords: string[]; fields?: ("title" | "body" | "source")[] }
  | { type: "exclude"; keywords: string[]; fields?: ("title" | "body" | "source")[] }
  | { type: "sort"; field: "timestamp" | "title" | "source"; direction?: "asc" | "desc" }
  | { type: "dedupe"; strategy?: "url" | "domain-normalized" | "title-similarity"; threshold?: number; keep?: "highest-score" | "earliest" | "latest"; log?: boolean }
  | { type: "keyword-score"; keywords: KeywordScoreEntry[]; min_score?: number; annotate?: boolean }
  | { type: "time-decay"; half_life?: string; engagement_weight?: number; recency_weight?: number; decay?: "exponential" | "linear"; annotate?: boolean; min_score?: number }
  | { type: "cluster"; strategy?: "domain" | "keywords" | "source" | "auto"; min_cluster_size?: number; max_clusters?: number; similarity_threshold?: number; annotate?: boolean }
  | { type: "llm-summarize" }
  | { type: "llm-filter"; criteria: string }
  | { type: "llm-rank"; interests?: string[] }
  | { type: "llm-merge"; prompt?: string };

// --- LLM ---

export interface LlmConfig {
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
  interests?: string[];
}

// --- Ingest ---

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

// --- Top-level ---

export interface AppConfig {
  adapters: IngestAdapterConfig[];
  pipelines?: PipelineConfig[];
  layout: LayoutNodeConfig;
  llm?: LlmConfig;
}

// --- Helpers ---

function defaultLayout(): LayoutNodeConfig {
  return {
    direction: "row",
    children: [{ panel: "all", source: "all", limit: 50 }],
  };
}

function defaultConfig(): AppConfig {
  return {
    adapters: [],
    layout: defaultLayout(),
  };
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
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

function validateSource(source: unknown, path: string): void {
  if (typeof source === "string") {
    if (source.trim().length === 0) {
      throw new Error(`config: ${path} must not be empty`);
    }
    return;
  }

  if (Array.isArray(source)) {
    if (source.length === 0) {
      throw new Error(`config: ${path} must not be an empty list`);
    }
    source.forEach((entry, index) => validateSource(entry, `${path}[${index}]`));
    return;
  }

  if (!isRecord(source)) {
    throw new Error(`config: ${path} must be a source name or source object`);
  }

  if (typeof source.adapter !== "string" || source.adapter.trim().length === 0) {
    throw new Error(`config: ${path}.adapter must be a non-empty string`);
  }
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
    if (typeof node.panel !== "string" || node.panel.trim().length === 0) {
      throw new Error(`config: ${path}.panel must be a non-empty string`);
    }
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
  const ids = new Set<string>();
  for (const p of panels) {
    if (ids.has(p.panel)) {
      throw new Error(`config: duplicate panel ID "${p.panel}"`);
    }
    ids.add(p.panel);
  }
}

function validateRefreshInterval(value: unknown, path: string): void {
  if (
    value !== undefined &&
    (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
  ) {
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

function validateOptionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`config: ${path} must be a boolean`);
  }
}

function validateOptionalNonEmptyString(value: unknown, path: string): void {
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`config: ${path} must be a non-empty string`);
  }
}

function validateStringList(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${path} must be a list`);
  }
  if (value.length === 0) {
    throw new Error(`config: ${path} must not be empty`);
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error(`config: ${path}[${index}] must be a non-empty string`);
    }
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
  if (!Array.isArray(value)) {
    throw new Error(`config: ${path} must be a list`);
  }
  if (value.length === 0) {
    throw new Error(`config: ${path} must not be empty`);
  }

  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      throw new Error(`config: ${entryPath} must be an object`);
    }
    if (typeof entry.term !== "string" || entry.term.trim().length === 0) {
      throw new Error(`config: ${entryPath}.term must be a non-empty string`);
    }
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
        if (!Array.isArray(transform.fields) || transform.fields.length === 0) {
          throw new Error(`config: ${path}.fields must be a non-empty list`);
        }
        transform.fields.forEach((field, fieldIndex) =>
          validateEnum(field, ["title", "body", "source"], `${path}.fields[${fieldIndex}]`)
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
      if (transform.min_score !== undefined) {
        validateFiniteNumber(transform.min_score, `${path}.min_score`);
      }
      validateOptionalBoolean(transform.annotate, `${path}.annotate`);
      break;
    case "time-decay":
      validateOptionalNonEmptyString(transform.half_life, `${path}.half_life`);
      if (transform.engagement_weight !== undefined) {
        validateFiniteNumber(transform.engagement_weight, `${path}.engagement_weight`);
      }
      if (transform.recency_weight !== undefined) {
        validateFiniteNumber(transform.recency_weight, `${path}.recency_weight`);
      }
      validateOptionalEnum(transform.decay, ["exponential", "linear"], `${path}.decay`);
      validateOptionalBoolean(transform.annotate, `${path}.annotate`);
      if (transform.min_score !== undefined) {
        validateFiniteNumber(transform.min_score, `${path}.min_score`);
      }
      break;
    case "cluster":
      validateOptionalEnum(transform.strategy, ["domain", "keywords", "source", "auto"], `${path}.strategy`);
      if (transform.min_cluster_size !== undefined) {
        validatePositiveInteger(transform.min_cluster_size, `${path}.min_cluster_size`);
      }
      if (transform.max_clusters !== undefined) {
        validatePositiveInteger(transform.max_clusters, `${path}.max_clusters`);
      }
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
    if (typeof transform.type !== "string" || transform.type.trim().length === 0) {
      throw new Error(`config: ${path}[${index}].type must be a non-empty string`);
    }
    validateTransform(transform, `${path}[${index}]`);
  });
}

function validateLlmConfig(llm: unknown): asserts llm is LlmConfig | undefined {
  if (llm === undefined) return;
  if (!isRecord(llm)) {
    throw new Error("config: llm must be an object");
  }

  validateOptionalNonEmptyString(llm.provider, "llm.provider");
  validateOptionalNonEmptyString(llm.model, "llm.model");
  validateOptionalNonEmptyString(llm.api_key, "llm.api_key");
  validateOptionalNonEmptyString(llm.base_url, "llm.base_url");
  validateOptionalStringList(llm.interests, "llm.interests");

  const configuredFields = ["provider", "model", "api_key"].filter((key) => llm[key] !== undefined);
  if (configuredFields.length > 0 && configuredFields.length < 3) {
    throw new Error("config: llm.provider, llm.model, and llm.api_key must be set together");
  }
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
  if (typeof adapter.type !== "string" || adapter.type.trim().length === 0) {
    throw new Error(`config: ${path}.type must be a non-empty string`);
  }
  if (
    adapter.name !== undefined &&
    (typeof adapter.name !== "string" || adapter.name.trim().length === 0)
  ) {
    throw new Error(`config: ${path}.name must be a non-empty string`);
  }
  if (adapter.params !== undefined && !isRecord(adapter.params)) {
    throw new Error(`config: ${path}.params must be an object`);
  }
  validateRefreshInterval(adapter.refresh_interval, `${path}.refresh_interval`);
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
  if (typeof pipeline.name !== "string" || pipeline.name.trim().length === 0) {
    throw new Error(`config: ${path}.name must be a non-empty string`);
  }
  if (!Array.isArray(pipeline.sources)) {
    throw new Error(`config: ${path}.sources must be a list`);
  }
  if (pipeline.sources.length === 0) {
    throw new Error(`config: ${path}.sources must not be empty`);
  }

  const seenSources = new Set<string>();
  pipeline.sources.forEach((source, sourceIndex) => {
    const sourcePath = `${path}.sources[${sourceIndex}]`;
    if (typeof source !== "string" || source.trim().length === 0) {
      throw new Error(`config: ${sourcePath} must be a non-empty string`);
    }
    if (seenSources.has(source)) {
      throw new Error(`config: ${sourcePath} duplicates source "${source}"`);
    }
    if (!sourceNames.has(source)) {
      throw new Error(`config: ${sourcePath} references unknown source "${source}"`);
    }
    seenSources.add(source);
  });

  validateTransforms(pipeline.transforms, `${path}.transforms`);
  validateRefreshInterval(pipeline.refresh_interval, `${path}.refresh_interval`);
}

export function loadConfig(): AppConfig {
  const configPath = process.env.PACE_CONFIG ?? join(process.cwd(), "config.yaml");
  const examplePath = join(process.cwd(), "config.example.yaml");

  let raw: string;
  if (existsSync(configPath)) {
    raw = readFileSync(configPath, "utf-8");
  } else if (existsSync(examplePath)) {
    raw = readFileSync(examplePath, "utf-8");
  } else {
    return defaultConfig();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (err) {
    const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(`config: failed to parse YAML: ${reason}`);
  }

  if (!parsed || typeof parsed !== "object") {
    return defaultConfig();
  }

  const resolved = resolveEnvInObject(parsed) as Record<string, unknown>;
  if (resolved.adapters !== undefined && !Array.isArray(resolved.adapters)) {
    throw new Error("config: adapters must be a list");
  }
  if (resolved.pipelines !== undefined && !Array.isArray(resolved.pipelines)) {
    throw new Error("config: pipelines must be a list");
  }

  const rawAdapters = (resolved.adapters ?? []) as unknown[];
  const rawPipelines = (resolved.pipelines ?? []) as unknown[];
  const layout = resolved.layout ?? defaultLayout();

  validateLayoutNode(layout);
  validatePanelIds(layout);

  rawAdapters.forEach(validateAdapterConfig);
  const adapters = rawAdapters as IngestAdapterConfig[];

  const names = new Set<string>();
  for (const a of adapters) {
    const n = a.name ?? a.type;
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
