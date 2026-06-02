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

export const DEDUPE_STRATEGIES = ["url", "domain-normalized", "title-similarity"] as const;
export type DedupeStrategy = (typeof DEDUPE_STRATEGIES)[number];

export const DEDUPE_KEEP_OPTIONS = ["highest-score", "earliest", "latest"] as const;
export type DedupeKeep = (typeof DEDUPE_KEEP_OPTIONS)[number];

/** Runtime defaults for dedupe transform (must match apply logic in transforms.ts). */
export const DEDUPE_DEFAULT_STRATEGY: DedupeStrategy = "url";
export const DEDUPE_DEFAULT_THRESHOLD = 0.85;
export const DEDUPE_DEFAULT_KEEP: DedupeKeep = "highest-score";

export function isDedupeStrategy(value: string): value is DedupeStrategy {
  return (DEDUPE_STRATEGIES as readonly string[]).includes(value);
}

/** Whether dedupe transform applies `threshold` at runtime (transforms.ts title-similarity). */
export function dedupeStrategyUsesThreshold(strategy: DedupeStrategy): boolean {
  return strategy === "title-similarity";
}

/** Whether dedupe transform applies `keep` at runtime (domain-normalized, title-similarity). */
export function dedupeStrategyUsesKeep(strategy: DedupeStrategy): boolean {
  return strategy === "domain-normalized" || strategy === "title-similarity";
}

export type TransformConfig =
  | { type: "latest"; count: number }
  | { type: "filter"; keywords: string[]; fields?: KeywordField[] }
  | { type: "exclude"; keywords: string[]; fields?: KeywordField[] }
  | { type: "sort"; field: "timestamp" | "title" | "source"; direction?: "asc" | "desc" }
  | { type: "dedupe"; strategy?: DedupeStrategy; threshold?: number; keep?: DedupeKeep; log?: boolean }
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

function resolveEnvVars(value: string, depth = 0): string {
  if (depth > MAX_ENV_EXPANSION_DEPTH) {
    const leftover = [...new Set([...value.matchAll(LEFTOVER_ENV_PLACEHOLDER)].map((m) => m[0]))];
    const hint = leftover.length ? `; still contains ${leftover.join(", ")}` : "";
    throw new Error(
      `config: env var expansion exceeded ${MAX_ENV_EXPANSION_DEPTH} passes (possible cycle)${hint}`,
    );
  }
  const replaced = value.replace(ENV_VAR_PLACEHOLDER, (_, name) => process.env[name] ?? "");
  if (replaced === value || !replaced.includes("${")) {
    assertEnvVarsFullyExpanded(replaced);
    return replaced;
  }
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
  if (isRecord(source.params)) {
    validateAdapterParams(source.adapter as string, source.params, path);
  }
  validateAllowedKeys(source, ["adapter", "params"], (key) =>
    `${path}.${key} is not a valid source field (set refresh_interval on adapters[], not panel source)`,
  );
}

function validatePanel(node: Record<string, unknown>, path: string): void {
  validateAllowedKeys(node, ["panel", "id", "flex", "source", "limit"], (key) =>
    `${path}.${key} is not a valid panel field`,
  );
  validateNonEmptyString(node.panel, `${path}.panel`);
  if (!("source" in node)) {
    throw new Error(`config: ${path}.source is required`);
  }
  validateSource(node.source, `${path}.source`);
  validateOptionalNonEmptyString(node.id, `${path}.id`);
  validateOptionalPositiveNumber(node.flex, `${path}.flex`);
  validateOptionalPositiveInteger(node.limit, `${path}.limit`);
}

function validateLayoutContainer(node: Record<string, unknown>, path: string): void {
  validateAllowedKeys(node, ["direction", "flex", "gap", "children"], (key) =>
    `${path}.${key} is not a valid layout container field`,
  );
  validateEnum(node.direction, ["row", "column"], `${path}.direction`);
  if (!Array.isArray(node.children)) {
    throw new Error(`config: ${path}.children must be a list`);
  }
  validateOptionalPositiveNumber(node.flex, `${path}.flex`);
  validateOptionalNonEmptyString(node.gap, `${path}.gap`);
  node.children.forEach((child, index) => validateLayoutNode(child, `${path}.children[${index}]`));
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
    validatePanel(node, path);
    return;
  }

  if (!hasContainer) {
    throw new Error(`config: ${path} must define either panel or direction/children`);
  }

  validateLayoutContainer(node, path);
}

function validatePanelNames(panels: PanelConfig[]): void {
  const names = new Set<string>();
  for (const p of panels) {
    if (names.has(p.panel)) {
      throw new Error(`config: duplicate panel name "${p.panel}"`);
    }
    names.add(p.panel);
  }
}

function validatePanelIds(panels: PanelConfig[]): void {
  const idToPanels = new Map<string, string[]>();
  const ids: string[] = [];
  for (const p of panels) {
    const id = resolvePanelId(p);
    ids.push(id);
    const list = idToPanels.get(id) ?? [];
    list.push(p.panel);
    idToPanels.set(id, list);
  }
  validateUniqueStrings(ids, "layout", "panel ID", {
    formatDuplicateError: (id) =>
      `config: duplicate panel ID "${id}" (panels: "${idToPanels.get(id)!.join('", "')}")`,
  });
}

function validatePanelSourceRefs(panels: PanelConfig[], sourceNames: Set<string>): void {
  for (const panel of panels) {
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

function validateLayout(layout: LayoutNodeConfig, sourceNames: Set<string>): void {
  validateLayoutNode(layout);
  const panels = collectPanels(layout);
  validatePanelNames(panels);
  validatePanelIds(panels);
  validatePanelSourceRefs(panels, sourceNames);
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

function validateUniqueUnnamedAdapterTypes(adapters: IngestAdapterConfig[]): void {
  const seenTypes = new Set<string>();
  for (let index = 0; index < adapters.length; index++) {
    const adapter = adapters[index]!;
    if (adapter.name !== undefined) continue;
    const { type } = adapter;
    if (seenTypes.has(type)) {
      throw new Error(
        `config: adapters[${index}] duplicates adapter type "${type}" (set name on each adapter to use multiple adapters of the same type)`,
      );
    }
    seenTypes.add(type);
  }
}

function validateUniqueStrings(
  entries: readonly string[],
  path: string,
  duplicateLabel: string,
  options?: { formatDuplicateError?: (entry: string, index: number) => string },
): void {
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (seen.has(entry)) {
      const message = options?.formatDuplicateError?.(entry, index)
        ?? `config: ${path}[${index}] duplicates ${duplicateLabel} "${entry}"`;
      throw new Error(message);
    }
    seen.add(entry);
  }
}

function validateUniqueStringList(
  value: unknown,
  path: string,
  allowed?: Set<string>,
  duplicateLabel = "source",
): asserts value is string[] {
  validateStringList(value, path);
  validateUniqueStrings(value, path, duplicateLabel);
  if (allowed) {
    for (let index = 0; index < value.length; index++) {
      const entry = value[index] as string;
      const entryPath = `${path}[${index}]`;
      if (!allowed.has(entry)) {
        throw new Error(`config: ${entryPath} references unknown source "${entry}"`);
      }
    }
  }
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

function resolveDedupeStrategyForValidation(strategy: unknown): DedupeStrategy {
  return strategy === undefined ? DEDUPE_DEFAULT_STRATEGY : (strategy as DedupeStrategy);
}

function validateDedupeStrategyFields(transform: Record<string, unknown>, path: string): void {
  const strategy = resolveDedupeStrategyForValidation(transform.strategy);

  if (transform.threshold !== undefined && !dedupeStrategyUsesThreshold(strategy)) {
    throw new Error(
      `config: ${path}.threshold is only valid for dedupe strategy "title-similarity" (got "${strategy}")`,
    );
  }
  if (transform.keep !== undefined && !dedupeStrategyUsesKeep(strategy)) {
    throw new Error(
      `config: ${path}.keep is only valid for dedupe strategies "domain-normalized" and "title-similarity" (got "${strategy}")`,
    );
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
  const transformType = transform.type;
  const unknownField = (key: string) =>
    `${path}.${key} is not a valid ${transformType} transform field`;

  switch (transformType) {
    case "latest":
      validateAllowedKeys(transform, ["type", "count"], unknownField);
      validatePositiveInteger(transform.count, `${path}.count`);
      break;
    case "filter":
    case "exclude":
      validateAllowedKeys(transform, ["type", "keywords", "fields"], unknownField);
      validateStringList(transform.keywords, `${path}.keywords`);
      if (transform.fields !== undefined) {
        validateNonEmptyArray(transform.fields, `${path}.fields`);
        transform.fields.forEach((field, fieldIndex) =>
          validateEnum(field, KEYWORD_FIELDS, `${path}.fields[${fieldIndex}]`)
        );
      }
      break;
    case "sort":
      validateAllowedKeys(transform, ["type", "field", "direction"], unknownField);
      validateEnum(transform.field, ["timestamp", "title", "source"], `${path}.field`);
      validateOptionalEnum(transform.direction, ["asc", "desc"], `${path}.direction`);
      break;
    case "dedupe":
      validateAllowedKeys(transform, ["type", "strategy", "threshold", "keep", "log"], unknownField);
      validateOptionalEnum(transform.strategy, DEDUPE_STRATEGIES, `${path}.strategy`);
      validateOptionalUnitNumber(transform.threshold, `${path}.threshold`);
      validateOptionalEnum(transform.keep, DEDUPE_KEEP_OPTIONS, `${path}.keep`);
      validateOptionalBoolean(transform.log, `${path}.log`);
      validateDedupeStrategyFields(transform, path);
      break;
    case "keyword-score":
      validateAllowedKeys(transform, ["type", "keywords", "min_score", "annotate"], unknownField);
      validateKeywordScoreEntries(transform.keywords, `${path}.keywords`);
      validateOptionalFiniteNumber(transform.min_score, `${path}.min_score`);
      validateOptionalBoolean(transform.annotate, `${path}.annotate`);
      break;
    case "time-decay":
      validateAllowedKeys(
        transform,
        ["type", "half_life", "engagement_weight", "recency_weight", "decay", "annotate", "min_score"],
        unknownField,
      );
      validateOptionalNonEmptyString(transform.half_life, `${path}.half_life`);
      validateOptionalFiniteNumber(transform.engagement_weight, `${path}.engagement_weight`);
      validateOptionalFiniteNumber(transform.recency_weight, `${path}.recency_weight`);
      validateOptionalEnum(transform.decay, ["exponential", "linear"], `${path}.decay`);
      validateOptionalBoolean(transform.annotate, `${path}.annotate`);
      validateOptionalFiniteNumber(transform.min_score, `${path}.min_score`);
      break;
    case "cluster":
      validateAllowedKeys(
        transform,
        ["type", "strategy", "min_cluster_size", "max_clusters", "similarity_threshold", "annotate"],
        unknownField,
      );
      validateOptionalEnum(transform.strategy, ["domain", "keywords", "source", "auto"], `${path}.strategy`);
      validateOptionalPositiveInteger(transform.min_cluster_size, `${path}.min_cluster_size`);
      validateOptionalPositiveInteger(transform.max_clusters, `${path}.max_clusters`);
      validateOptionalUnitNumber(transform.similarity_threshold, `${path}.similarity_threshold`);
      validateOptionalBoolean(transform.annotate, `${path}.annotate`);
      break;
    case "llm-summarize":
      validateAllowedKeys(transform, ["type"], unknownField);
      break;
    case "llm-filter":
      validateAllowedKeys(transform, ["type", "criteria"], unknownField);
      validateOptionalNonEmptyString(transform.criteria, `${path}.criteria`);
      if (transform.criteria === undefined) {
        throw new Error(`config: ${path}.criteria is required`);
      }
      break;
    case "llm-rank":
      validateAllowedKeys(transform, ["type", "interests"], unknownField);
      validateOptionalStringList(transform.interests, `${path}.interests`);
      break;
    case "llm-merge":
      validateAllowedKeys(transform, ["type", "prompt"], unknownField);
      validateOptionalNonEmptyString(transform.prompt, `${path}.prompt`);
      break;
    default:
      throw new Error(`config: ${path}.type references unknown transform "${transformType}"`);
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

  const LLM_CONFIG_FIELDS = ["provider", "model", "api_key", "base_url", "interests"] as const;
  validateAllowedKeys(llm, LLM_CONFIG_FIELDS, (key) => `llm.${key} is not a valid llm field`);
  for (const key of ["provider", "model", "api_key", "base_url"] as const) {
    validateOptionalNonEmptyString(llm[key], `llm.${key}`);
  }
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

/** Known adapter types and their allowed `params` keys (from adapter implementations). */
const ADAPTER_PARAM_KEYS: Readonly<Record<string, readonly string[]>> = {
  hackernews: ["feed", "stories", "limit", "min_score"],
  lobsters: ["feed", "limit", "min_score", "tags"],
  rss: ["urls"],
  reddit: ["subreddits", "sort", "limit", "min_score", "time"],
  github: ["mode", "language", "since", "limit", "repos", "token"],
  "github-releases": ["repos", "token"],
  devto: ["tags", "username", "limit", "min_reactions", "top"],
  mastodon: ["instance", "hashtags", "accounts", "limit", "only_media"],
  youtube: ["channels", "playlists", "limit"],
  arxiv: ["categories", "query", "limit"],
  stackexchange: ["site", "tags", "sort", "limit", "min_score"],
  producthunt: ["limit", "min_upvotes", "enrich"],
  podcast: ["feeds", "limit"],
  twitter: ["lists", "searches", "bearer_token"],
  npm: ["keywords", "scope", "limit", "sort"],
  lemmy: ["instance", "communities", "sort", "limit", "min_score"],
  wikipedia: ["modes", "mode", "language", "limit"],
};

function validateAdapterParams(
  type: string,
  params: Record<string, unknown>,
  path: string,
): void {
  const allowed = ADAPTER_PARAM_KEYS[type];
  if (!allowed) return;
  validateAllowedKeys(params, allowed, (key) => `${path}.params.${key} is not a valid ${type} param`);
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
  if (isRecord(adapter.params)) {
    validateAdapterParams(adapter.type as string, adapter.params, path);
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
  validateUniqueStringList(pipeline.sources, `${path}.sources`, sourceNames);

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
