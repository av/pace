import { ADAPTER_PARAM_KEYS, isAdapterType } from "./adapters/params";
import {
  CLUSTER_STRATEGIES,
  collectPanels,
  DECAY_TYPES,
  DEDUPE_DEFAULT_STRATEGY,
  DEDUPE_KEEP_OPTIONS,
  DEDUPE_STRATEGIES,
  isRecord,
  KEYWORD_FIELDS,
  LAYOUT_DIRECTIONS,
  normalizeSource,
  resolvePanelId,
  SORT_DIRECTIONS,
  SORT_FIELDS,
  type DedupeStrategy,
  type IngestAdapterConfig,
  type LayoutNodeConfig,
  type LlmConfig,
  type PanelConfig,
  type PipelineConfig,
  type TransformConfig,
} from "./config";
import {
  KEYWORD_SCORE_ENTRY_FIELDS,
  TRANSFORM_FIELD_KEYS,
  transformAllowedFieldKeys,
  type TransformType,
} from "./transform-schema";
import { getAdapterName } from "./utils";

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

function optionalValidator(validator: (v: unknown, p: string) => void): (value: unknown, path: string) => void {
  return (value, path) => validateOptional(value, path, validator);
}

function validateBoolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") {
    throw new Error(`config: ${path} must be a boolean`);
  }
}

function validateList(value: unknown, path: string): void {
  if (!Array.isArray(value)) {
    throw new Error(`config: ${path} must be a list`);
  }
}

function validateUnitNumber(value: unknown, path: string): void {
  validateFiniteNumber(value, path);
  if ((value as number) < 0 || (value as number) > 1) {
    throw new Error(`config: ${path} must be between 0 and 1`);
  }
}

const validateOptionalPositiveNumber = optionalValidator(validatePositiveNumber);
const validateOptionalPositiveInteger = optionalValidator(validatePositiveInteger);
const validateOptionalFiniteNumber = optionalValidator(validateFiniteNumber);
const validateOptionalBoolean = optionalValidator(validateBoolean);
const validateOptionalNonEmptyString = optionalValidator(validateNonEmptyString);
export const validateOptionalList = optionalValidator(validateList);
const validateOptionalUnitNumber = optionalValidator(validateUnitNumber);

function validateStringList(value: unknown, path: string): void {
  validateNonEmptyArray(value, path);
  value.forEach((entry, index) => {
    validateNonEmptyString(entry, `${path}[${index}]`);
  });
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

export function validateUniqueStringList(
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

const validateOptionalStringList = optionalValidator(validateStringList);

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
  validateOptional(value, path, (v, p) => validateEnum(v, allowed, p));
}

function validateNestedParams(type: string, params: unknown, path: string): void {
  if (params === undefined) return;
  if (!isRecord(params)) {
    throw new Error(`config: ${path}.params must be an object`);
  }
  if (!isAdapterType(type)) return;
  const allowed = ADAPTER_PARAM_KEYS[type];
  validateAllowedKeys(params, allowed, (key) => `${path}.params.${key} is not a valid ${type} param`);
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
  validateNestedParams(source.adapter as string, source.params, path);
  validateAllowedKeys(source, ["adapter", "params"], (key) =>
    `${path}.${key} is not a valid source field`,
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
  validateEnum(node.direction, LAYOUT_DIRECTIONS, `${path}.direction`);
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
  const names = panels.map((p) => p.panel);
  validateUniqueStrings(names, "layout", "panel name", {
    formatDuplicateError: (name) => `config: duplicate panel name "${name}"`,
  });
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

export function validateLayout(layout: LayoutNodeConfig, sourceNames: Set<string>): void {
  validateLayoutNode(layout);
  const panels = collectPanels(layout);
  validatePanelNames(panels);
  validatePanelIds(panels);
  validatePanelSourceRefs(panels, sourceNames);
}

export function validateUniqueUnnamedAdapterTypes(adapters: IngestAdapterConfig[]): void {
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

function resolveDedupeStrategyForValidation(strategy: unknown): DedupeStrategy {
  return strategy === undefined ? DEDUPE_DEFAULT_STRATEGY : (strategy as DedupeStrategy);
}

function validateDedupeStrategyFields(transform: Record<string, unknown>, path: string): void {
  const strategy = resolveDedupeStrategyForValidation(transform.strategy);

  if (transform.threshold !== undefined && strategy !== "title-similarity") {
    throw new Error(
      `config: ${path}.threshold is only valid for dedupe strategy "title-similarity" (got "${strategy}")`,
    );
  }
  if (
    transform.keep !== undefined &&
    strategy !== "domain-normalized" &&
    strategy !== "title-similarity"
  ) {
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
    validateAllowedKeys(entry, KEYWORD_SCORE_ENTRY_FIELDS, (key) =>
      `${entryPath}.${key} is not a valid keyword-score entry field`,
    );
    validateNonEmptyString(entry.term, `${entryPath}.term`);
    validateFiniteNumber(entry.weight, `${entryPath}.weight`);
    validateOptionalBoolean(entry.regex, `${entryPath}.regex`);
  });
}

type TransformFieldValidator = (transform: Record<string, unknown>, path: string) => void;

interface TransformSchema {
  fields: readonly string[];
  validate?: TransformFieldValidator;
}

function validateFilterExcludeFields(transform: Record<string, unknown>, path: string): void {
  validateStringList(transform.keywords, `${path}.keywords`);
  if (transform.fields !== undefined) {
    validateNonEmptyArray(transform.fields, `${path}.fields`);
    transform.fields.forEach((field, fieldIndex) =>
      validateEnum(field, KEYWORD_FIELDS, `${path}.fields[${fieldIndex}]`),
    );
  }
}

const TRANSFORM_VALIDATORS: Readonly<Partial<Record<TransformType, TransformFieldValidator>>> = {
  latest: (transform, path) => validatePositiveInteger(transform.count, `${path}.count`),
  filter: validateFilterExcludeFields,
  exclude: validateFilterExcludeFields,
  sort: (transform, path) => {
    validateEnum(transform.field, SORT_FIELDS, `${path}.field`);
    validateOptionalEnum(transform.direction, SORT_DIRECTIONS, `${path}.direction`);
  },
  dedupe: (transform, path) => {
    validateOptionalEnum(transform.strategy, DEDUPE_STRATEGIES, `${path}.strategy`);
    validateOptionalUnitNumber(transform.threshold, `${path}.threshold`);
    validateOptionalEnum(transform.keep, DEDUPE_KEEP_OPTIONS, `${path}.keep`);
    validateOptionalBoolean(transform.log, `${path}.log`);
    validateDedupeStrategyFields(transform, path);
  },
  "keyword-score": (transform, path) => {
    validateKeywordScoreEntries(transform.keywords, `${path}.keywords`);
    validateOptionalFiniteNumber(transform.min_score, `${path}.min_score`);
    validateOptionalBoolean(transform.annotate, `${path}.annotate`);
  },
  "time-decay": (transform, path) => {
    validateOptionalNonEmptyString(transform.half_life, `${path}.half_life`);
    validateOptionalFiniteNumber(transform.engagement_weight, `${path}.engagement_weight`);
    validateOptionalFiniteNumber(transform.recency_weight, `${path}.recency_weight`);
    validateOptionalEnum(transform.decay, DECAY_TYPES, `${path}.decay`);
    validateOptionalBoolean(transform.annotate, `${path}.annotate`);
    validateOptionalFiniteNumber(transform.min_score, `${path}.min_score`);
  },
  cluster: (transform, path) => {
    validateOptionalEnum(transform.strategy, CLUSTER_STRATEGIES, `${path}.strategy`);
    validateOptionalPositiveInteger(transform.min_cluster_size, `${path}.min_cluster_size`);
    validateOptionalPositiveInteger(transform.max_clusters, `${path}.max_clusters`);
    validateOptionalUnitNumber(transform.similarity_threshold, `${path}.similarity_threshold`);
    validateOptionalBoolean(transform.annotate, `${path}.annotate`);
  },
  "llm-filter": (transform, path) => {
    validateOptionalNonEmptyString(transform.criteria, `${path}.criteria`);
    if (transform.criteria === undefined) {
      throw new Error(`config: ${path}.criteria is required`);
    }
  },
  "llm-rank": (transform, path) => validateOptionalStringList(transform.interests, `${path}.interests`),
  "llm-merge": (transform, path) => validateOptionalNonEmptyString(transform.prompt, `${path}.prompt`),
};

const TRANSFORM_SCHEMAS: Readonly<Record<TransformType, TransformSchema>> = Object.fromEntries(
  (Object.keys(TRANSFORM_FIELD_KEYS) as TransformType[]).map((transformType) => [
    transformType,
    {
      fields: transformAllowedFieldKeys(transformType),
      validate: TRANSFORM_VALIDATORS[transformType],
    },
  ]),
) as Readonly<Record<TransformType, TransformSchema>>;

function isTransformType(value: string): value is TransformType {
  return value in TRANSFORM_SCHEMAS;
}

function validateTransform(transform: Record<string, unknown>, path: string): void {
  const transformType = transform.type;
  if (typeof transformType !== "string" || !isTransformType(transformType)) {
    throw new Error(`config: ${path}.type references unknown transform "${transformType}"`);
  }
  const schema = TRANSFORM_SCHEMAS[transformType];
  validateAllowedKeys(transform, schema.fields, (key) =>
    `${path}.${key} is not a valid ${transformType} transform field`,
  );
  schema.validate?.(transform, path);
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

export function validateLlmConfig(llm: unknown): asserts llm is LlmConfig | undefined {
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

const TOP_LEVEL_CONFIG_FIELDS = ["adapters", "pipelines", "layout", "llm"] as const;

export function validateTopLevelKeys(config: Record<string, unknown>): void {
  validateAllowedKeys(config, TOP_LEVEL_CONFIG_FIELDS, (key) => `${key} is not a valid top-level field`);
}

export function validateAdapterConfig(adapter: unknown, index: number): asserts adapter is IngestAdapterConfig {
  const path = `adapters[${index}]`;
  if (!isRecord(adapter)) {
    throw new Error(`config: ${path} must be an object`);
  }
  validateAllowedKeys(adapter, ["type", "name", "params", "refresh_interval", "transforms"], (key) =>
    `${path}.${key} is not a valid adapter field`,
  );
  validateNonEmptyString(adapter.type, `${path}.type`);
  validateOptionalNonEmptyString(adapter.name, `${path}.name`);
  validateNestedParams(adapter.type as string, adapter.params, path);
  validateOptionalPositiveNumber(adapter.refresh_interval, `${path}.refresh_interval`);
  if (adapter.transforms !== undefined) {
    validateTransforms(adapter.transforms, `${path}.transforms`);
  }
}

export function validatePipelineConfig(
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

function validatePipelineAdapterNameCollision(
  pipelines: readonly PipelineConfig[],
  adapterNames: Set<string>,
): void {
  for (const pipeline of pipelines) {
    if (adapterNames.has(pipeline.name)) {
      throw new Error(`config: duplicate pipeline/adapter name "${pipeline.name}"`);
    }
    adapterNames.add(pipeline.name);
  }
}

export interface ValidatedConfigSections {
  adapters: IngestAdapterConfig[];
  pipelines: PipelineConfig[];
  layout: LayoutNodeConfig;
  llm: LlmConfig | undefined;
}

/** Validate resolved config object (post-YAML/env); shared by loadConfig. */
export function validateParsedConfig(
  resolved: Record<string, unknown>,
  defaultLayout: LayoutNodeConfig,
): ValidatedConfigSections {
  validateTopLevelKeys(resolved);
  validateOptionalList(resolved.adapters, "adapters");
  validateOptionalList(resolved.pipelines, "pipelines");

  const rawAdapters = (resolved.adapters ?? []) as unknown[];
  const rawPipelines = (resolved.pipelines ?? []) as unknown[];
  const layout = (resolved.layout ?? defaultLayout) as LayoutNodeConfig;

  rawAdapters.forEach(validateAdapterConfig);
  const adapters = rawAdapters as IngestAdapterConfig[];
  validateUniqueUnnamedAdapterTypes(adapters);

  const adapterNames = adapters.map(getAdapterName);
  if (adapterNames.length > 0) {
    validateUniqueStringList(adapterNames, "adapters", undefined, "adapter name");
  }

  const sourceNames = new Set(adapterNames);
  for (const [index, pipeline] of rawPipelines.entries()) {
    validatePipelineConfig(pipeline, index, sourceNames);
  }
  const pipelines = rawPipelines as PipelineConfig[];

  const pipelineNames = pipelines.map((pipeline) => pipeline.name);
  if (pipelineNames.length > 0) {
    validateUniqueStringList(pipelineNames, "pipelines", undefined, "pipeline name");
  }
  validatePipelineAdapterNameCollision(pipelines, sourceNames);

  validateLayout(layout, sourceNames);
  validateLlmConfig(resolved.llm);

  return {
    adapters,
    pipelines,
    layout,
    llm: resolved.llm as LlmConfig | undefined,
  };
}