import { ADAPTER_PARAM_KEYS, isAdapterType } from "./adapters/params";
import {
  collectPanels,
  isRecord,
  LAYOUT_DIRECTIONS,
  normalizeSource,
  resolvePanelId,
  type IngestAdapterConfig,
  type LayoutNodeConfig,
  type LlmConfig,
  type PanelConfig,
  type PipelineConfig,
} from "./config/types";
import { validateTransforms } from "./transform-validate";
import { getAdapterName } from "./utils";
import {
  validateAllowedKeys,
  validateEnum,
  validateOptionalEnum,
  validateNonEmptyArray,
  validateNonEmptyString,
  validateOptionalList,
  validateOptionalNonEmptyString,
  validateOptionalPositiveInteger,
  validateOptionalPositiveNumber,
  validateOptionalStringList,
  validateUniqueStringList,
  validateUniqueStrings,
} from "./validate-primitives";

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

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateSafeUrl(url: unknown, path: string): void {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`config: ${path} must be a non-empty URL string`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`config: ${path} is not a valid URL`);
  }
  if (parsed.protocol === "https:") return;
  if (parsed.protocol === "http:" && LOCALHOST_HOSTS.has(parsed.hostname)) return;
  throw new Error(`config: ${path} has disallowed scheme "${parsed.protocol.replace(/:$/, "")}"`);
}

const IMAGE_OBJECT_FIT_VALUES = ["cover", "contain", "fill", "none"] as const;

function validateImageWidget(node: Record<string, unknown>, path: string): void {
  validateAllowedKeys(node, ["image", "flex", "alt", "object_fit", "max_height", "link"], (key) =>
    `${path}.${key} is not a valid image widget field`,
  );
  validateNonEmptyString(node.image, `${path}.image`);
  validateOptionalPositiveNumber(node.flex, `${path}.flex`);
  validateOptionalNonEmptyString(node.alt, `${path}.alt`);
  validateOptionalEnum(node.object_fit, IMAGE_OBJECT_FIT_VALUES, `${path}.object_fit`);
  validateOptionalNonEmptyString(node.max_height, `${path}.max_height`);
  if (node.link !== undefined) {
    validateSafeUrl(node.link, `${path}.link`);
  }
}

const TEXT_FORMAT_VALUES = ["plain", "markdown", "html"] as const;

function validateTextWidget(node: Record<string, unknown>, path: string): void {
  validateAllowedKeys(node, ["text", "format", "title", "flex"], (key) =>
    `${path}.${key} is not a valid text widget field`,
  );
  validateNonEmptyString(node.text, `${path}.text`);
  validateOptionalEnum(node.format, TEXT_FORMAT_VALUES, `${path}.format`);
  validateOptionalNonEmptyString(node.title, `${path}.title`);
  validateOptionalPositiveNumber(node.flex, `${path}.flex`);
}

function validateIframeWidget(node: Record<string, unknown>, path: string): void {
  validateAllowedKeys(node, ["iframe", "flex", "title", "height", "aspect_ratio", "sandbox", "allow"], (key) =>
    `${path}.${key} is not a valid iframe widget field`,
  );
  validateSafeUrl(node.iframe, `${path}.iframe`);
  validateOptionalPositiveNumber(node.flex, `${path}.flex`);
  validateOptionalNonEmptyString(node.title, `${path}.title`);
  validateOptionalNonEmptyString(node.height, `${path}.height`);
  validateOptionalNonEmptyString(node.aspect_ratio, `${path}.aspect_ratio`);
  validateOptionalNonEmptyString(node.sandbox, `${path}.sandbox`);
  validateOptionalNonEmptyString(node.allow, `${path}.allow`);
}

const LAYOUT_DISCRIMINATORS = ["panel", "direction", "image", "text", "iframe"] as const;

function validateLayoutNode(node: unknown, path = "layout"): asserts node is LayoutNodeConfig {
  if (!isRecord(node)) {
    throw new Error(`config: ${path} must be a layout node object`);
  }

  const found = LAYOUT_DISCRIMINATORS.filter((k) => k in node);
  if (found.length === 0) {
    throw new Error(`config: ${path} must define one of: panel, direction, image, text, iframe`);
  }
  if (found.length > 1) {
    throw new Error(`config: ${path} has conflicting keys: ${found.join(", ")}`);
  }

  switch (found[0]) {
    case "panel":
      validatePanel(node, path);
      return;
    case "direction":
      validateLayoutContainer(node, path);
      return;
    case "image":
      validateImageWidget(node, path);
      return;
    case "text":
      validateTextWidget(node, path);
      return;
    case "iframe":
      validateIframeWidget(node, path);
      return;
  }
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