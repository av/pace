import { ADAPTER_PARAM_KEYS, ADAPTER_TYPES, isAdapterType } from "./adapters/params";
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
import { warnConfig } from "./config-warn";
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
  validateOptionalNonNegativeNumber,
  validateOptionalPositiveNumber,
  validateOptionalStringList,
  validateUniqueStringList,
  validateUniqueStrings,
} from "./validate-primitives";

/** Common adapter type misspellings mapped to the correct type. */
const ADAPTER_TYPE_SUGGESTIONS: Record<string, string> = {
  bookmark: "bookmarks",
  book: "bookmarks",
  links: "bookmarks",
  count: "counter",
  counters: "counter",
  stat: "counter",
  stats: "counter",
  hn: "hackernews",
  "hacker-news": "hackernews",
  feed: "rss",
  atom: "rss",
  gh: "github",
  "gh-releases": "github-releases",
  so: "stackexchange",
  stackoverflow: "stackexchange",
  stack: "stackexchange",
  yt: "youtube",
  video: "youtube",
  wiki: "wikipedia",
  ph: "producthunt",
  "product-hunt": "producthunt",
  pod: "podcast",
  podcasts: "podcast",
};

/** Find the closest known adapter type for a misspelled type string. */
function findClosestAdapterType(input: string): string | null {
  const lower = input.toLowerCase();
  // Check hardcoded suggestions first
  if (ADAPTER_TYPE_SUGGESTIONS[lower]) return ADAPTER_TYPE_SUGGESTIONS[lower];
  // Check if input is a substring of any adapter type or vice versa
  for (const type of ADAPTER_TYPES) {
    if (type.includes(lower) || lower.includes(type)) return type;
  }
  return null;
}

const JSON_PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*$/;
const DANGEROUS_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function containsDangerousSegment(jsonPath: string): boolean {
  const segments = jsonPath.split(/[.\[]/);
  return segments.some((s) => DANGEROUS_PATH_SEGMENTS.has(s.replace("]", "")));
}

function validateCounterParams(params: Record<string, unknown>, path: string): void {
  if (!params.url) {
    throw new Error(`config: ${path}.params.url is required for counter adapter`);
  }
  validateSafeUrl(params.url, `${path}.params.url`);

  if (!params.json_path) {
    throw new Error(`config: ${path}.params.json_path is required for counter adapter`);
  }
  validateNonEmptyString(params.json_path, `${path}.params.json_path`);
  if (typeof params.json_path === "string" && !JSON_PATH_RE.test(params.json_path)) {
    const hint = params.json_path.startsWith("$")
      ? ' (do not use JSONPath "$." prefix; use plain dot notation like "data.count")'
      : "";
    throw new Error(`config: ${path}.params.json_path must be a valid dot-notation path${hint}`);
  }
  if (typeof params.json_path === "string" && containsDangerousSegment(params.json_path)) {
    throw new Error(`config: ${path}.params.json_path contains a disallowed segment`);
  }

  if (params.compare_url !== undefined) {
    validateSafeUrl(params.compare_url, `${path}.params.compare_url`);
  }

  if (params.compare_path !== undefined) {
    validateNonEmptyString(params.compare_path, `${path}.params.compare_path`);
    if (typeof params.compare_path === "string" && !JSON_PATH_RE.test(params.compare_path)) {
      const hint = (params.compare_path as string).startsWith("$")
        ? ' (do not use JSONPath "$." prefix; use plain dot notation like "data.count")'
        : "";
      throw new Error(`config: ${path}.params.compare_path must be a valid dot-notation path${hint}`);
    }
    if (typeof params.compare_path === "string" && containsDangerousSegment(params.compare_path)) {
      throw new Error(`config: ${path}.params.compare_path contains a disallowed segment`);
    }
  }

  if (params.headers !== undefined) {
    if (!isRecord(params.headers)) {
      throw new Error(`config: ${path}.params.headers must be an object`);
    }
    for (const [key, value] of Object.entries(params.headers)) {
      if (typeof value !== "string") {
        throw new Error(`config: ${path}.params.headers.${key} must be a string`);
      }
    }
  }
}

function validateBookmarksParams(params: Record<string, unknown>, path: string): void {
  if (!params.items) {
    throw new Error(`config: ${path}.params.items is required for bookmarks adapter`);
  }
  validateNonEmptyArray(params.items, `${path}.params.items`);
  for (let i = 0; i < (params.items as unknown[]).length; i++) {
    const item = (params.items as unknown[])[i];
    const itemPath = `${path}.params.items[${i}]`;
    if (!isRecord(item)) {
      throw new Error(`config: ${itemPath} must be an object with title and url`);
    }
    validateNonEmptyString(item.title, `${itemPath}.title`);
    validateNonEmptyString(item.url, `${itemPath}.url`);
    if (typeof item.url === "string") {
      validateSafeUrl(item.url, `${itemPath}.url`);
    }
  }
}

/** Map of common wrong param key names to the correct key, per adapter type. */
const ADAPTER_PARAM_SUGGESTIONS: Partial<Record<string, Record<string, string>>> = {
  counter: {
    path: "json_path",
    jsonpath: "json_path",
    json: "json_path",
    endpoint: "url",
    api: "url",
    api_url: "url",
    name: "label",
    title: "label",
    suffix: "unit",
  },
  bookmarks: {
    links: "items",
    urls: "items",
    entries: "items",
    bookmarks: "items",
    list: "items",
  },
};

function validateNestedParams(type: string, params: unknown, path: string): void {
  if (params === undefined) return;
  if (!isRecord(params)) {
    throw new Error(`config: ${path}.params must be an object`);
  }
  if (!isAdapterType(type)) return;
  const allowed = ADAPTER_PARAM_KEYS[type];
  const suggestions = ADAPTER_PARAM_SUGGESTIONS[type];
  validateAllowedKeys(params, allowed, (key) => {
    const suggestion = suggestions?.[key];
    if (suggestion) {
      return `${path}.params.${key} is not a valid ${type} param; did you mean "${suggestion}"?`;
    }
    return `${path}.params.${key} is not a valid ${type} param`;
  });

  if (type === "counter") {
    validateCounterParams(params, path);
  }
  if (type === "bookmarks") {
    validateBookmarksParams(params, path);
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
  validateNestedParams(source.adapter as string, source.params, path);
  validateAllowedKeys(source, ["adapter", "params"], (key) =>
    `${path}.${key} is not a valid source field`,
  );
}

const PANEL_DISPLAY_VALUES = ["counter"] as const;

function validatePanel(node: Record<string, unknown>, path: string): void {
  validateAllowedKeys(node, ["panel", "id", "flex", "source", "limit", "display"], (key) =>
    `${path}.${key} is not a valid panel field`,
  );
  validateNonEmptyString(node.panel, `${path}.panel`);
  if (!("source" in node)) {
    throw new Error(`config: ${path}.source is required`);
  }
  validateSource(node.source, `${path}.source`);
  validateOptionalNonEmptyString(node.id, `${path}.id`);
  validateOptionalNonNegativeNumber(node.flex, `${path}.flex`);
  validateOptionalPositiveInteger(node.limit, `${path}.limit`);
  validateOptionalEnum(node.display, PANEL_DISPLAY_VALUES, `${path}.display`);
}

function validateLayoutContainer(node: Record<string, unknown>, path: string): void {
  validateAllowedKeys(node, ["direction", "flex", "gap", "children"], (key) =>
    `${path}.${key} is not a valid layout container field`,
  );
  validateEnum(node.direction, LAYOUT_DIRECTIONS, `${path}.direction`);
  validateNonEmptyArray(node.children, `${path}.children`);
  validateOptionalNonNegativeNumber(node.flex, `${path}.flex`);
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

const IMAGE_WIDGET_KEY_SUGGESTIONS: Record<string, string> = {
  "object-fit": "object_fit",
  objectfit: "object_fit",
  objectFit: "object_fit",
  fit: "object_fit",
  "max-height": "max_height",
  maxHeight: "max_height",
  height: "max_height",
  src: "image",
  url: "image",
  href: "link",
};

function validateImageWidget(node: Record<string, unknown>, path: string): void {
  const allowed = ["image", "flex", "alt", "object_fit", "max_height", "link"];
  validateAllowedKeys(node, allowed, (key) => {
    const suggestion = IMAGE_WIDGET_KEY_SUGGESTIONS[key];
    if (suggestion) {
      return `${path}.${key} is not a valid image widget field; did you mean "${suggestion}"?`;
    }
    return `${path}.${key} is not a valid image widget field`;
  });
  validateSafeUrl(node.image, `${path}.image`);
  validateOptionalNonNegativeNumber(node.flex, `${path}.flex`);
  validateOptionalNonEmptyString(node.alt, `${path}.alt`);
  validateOptionalEnum(node.object_fit, IMAGE_OBJECT_FIT_VALUES, `${path}.object_fit`);
  validateOptionalNonEmptyString(node.max_height, `${path}.max_height`);
  if (node.link !== undefined) {
    validateSafeUrl(node.link, `${path}.link`);
  }
}

const TEXT_FORMAT_VALUES = ["plain", "markdown", "html"] as const;

const TEXT_WIDGET_KEY_SUGGESTIONS: Record<string, string> = {
  content: "text",
  body: "text",
  value: "text",
  markdown: 'format (use format: markdown instead of markdown: true)',
  html: 'format (use format: html instead of a separate html key)',
};

function validateTextWidget(node: Record<string, unknown>, path: string): void {
  const allowed = ["text", "format", "title", "flex"];
  validateAllowedKeys(node, allowed, (key) => {
    const suggestion = TEXT_WIDGET_KEY_SUGGESTIONS[key];
    if (suggestion) {
      return `${path}.${key} is not a valid text widget field; did you mean "${suggestion}"?`;
    }
    return `${path}.${key} is not a valid text widget field`;
  });
  validateNonEmptyString(node.text, `${path}.text`);
  validateOptionalEnum(node.format, TEXT_FORMAT_VALUES, `${path}.format`);
  validateOptionalNonEmptyString(node.title, `${path}.title`);
  validateOptionalNonNegativeNumber(node.flex, `${path}.flex`);
}

const ASPECT_RATIO_RE = /^\d+\/\d+$/;
const CSS_LENGTH_RE = /^\d+(px|rem|em|vh|%)$/;

export const VALID_SANDBOX_TOKENS = new Set([
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-orientation-lock",
  "allow-pointer-lock",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-presentation",
  "allow-same-origin",
  "allow-scripts",
  "allow-top-navigation",
  "allow-top-navigation-by-user-activation",
  "allow-top-navigation-to-custom-protocols",
]);

/** Validate sandbox tokens; warns about and strips invalid ones. Returns cleaned string. */
export function sanitizeSandboxTokens(value: string, path: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  const valid: string[] = [];
  for (const token of tokens) {
    if (VALID_SANDBOX_TOKENS.has(token)) {
      valid.push(token);
    } else {
      warnConfig(`${path} contains invalid sandbox token "${token}" (stripped)`);
    }
  }
  return valid.join(" ");
}

const IFRAME_WIDGET_KEY_SUGGESTIONS: Record<string, string> = {
  ratio: "aspect_ratio",
  "aspect-ratio": "aspect_ratio",
  aspectRatio: "aspect_ratio",
  url: "iframe",
  src: "iframe",
  embed: "iframe",
};

function validateIframeWidget(node: Record<string, unknown>, path: string): void {
  const allowed = ["iframe", "flex", "title", "height", "aspect_ratio", "sandbox", "allow"];
  validateAllowedKeys(node, allowed, (key) => {
    const suggestion = IFRAME_WIDGET_KEY_SUGGESTIONS[key];
    if (suggestion) {
      return `${path}.${key} is not a valid iframe widget field; did you mean "${suggestion}"?`;
    }
    return `${path}.${key} is not a valid iframe widget field`;
  });
  validateSafeUrl(node.iframe, `${path}.iframe`);
  validateOptionalNonNegativeNumber(node.flex, `${path}.flex`);
  validateOptionalNonEmptyString(node.title, `${path}.title`);
  validateOptionalNonEmptyString(node.allow, `${path}.allow`);

  if (node.height !== undefined) {
    if (typeof node.height !== "string" || !CSS_LENGTH_RE.test(node.height)) {
      throw new Error(`config: ${path}.height must be a valid CSS length (e.g. 400px, 20rem, 50vh)`);
    }
  }

  if (node.aspect_ratio !== undefined) {
    if (typeof node.aspect_ratio !== "string" || !ASPECT_RATIO_RE.test(node.aspect_ratio)) {
      throw new Error(`config: ${path}.aspect_ratio must match the format "N/N" (e.g. 16/9)`);
    }
  }

  if (node.sandbox !== undefined) {
    validateOptionalNonEmptyString(node.sandbox, `${path}.sandbox`);
    sanitizeSandboxTokens(node.sandbox as string, path);
  }
}

const LAYOUT_DISCRIMINATORS = ["panel", "direction", "image", "text", "iframe"] as const;

/**
 * Map of common wrong key names to the correct discriminator key,
 * so the error message can suggest what the user probably meant.
 */
const LAYOUT_KEY_SUGGESTIONS: Record<string, string> = {
  img: "image",
  imge: "image",
  images: "image",
  src: "image",
  picture: "image",
  photo: "image",
  content: "text",
  body: "text",
  markdown: "text",
  html: "text",
  txt: "text",
  label: "text",
  url: "iframe",
  embed: "iframe",
  frame: "iframe",
  iframes: "iframe",
  link: "image",
  ratio: "iframe",
  aspect_ratio: "iframe",
  panels: "panel",
  source: "panel",
  dir: "direction",
  layout: "direction",
  row: "direction",
  column: "direction",
  col: "direction",
};

function validateLayoutNode(node: unknown, path = "layout"): asserts node is LayoutNodeConfig {
  if (!isRecord(node)) {
    throw new Error(`config: ${path} must be a layout node object`);
  }

  const found = LAYOUT_DISCRIMINATORS.filter((k) => k in node);
  if (found.length === 0) {
    // Check for common wrong key names and suggest the correct one
    const nodeKeys = Object.keys(node);
    for (const key of nodeKeys) {
      const suggestion = LAYOUT_KEY_SUGGESTIONS[key];
      if (suggestion) {
        throw new Error(
          `config: ${path} has unknown key "${key}"; did you mean "${suggestion}"? ` +
          `Layout nodes must use one of: panel, direction, image, text, iframe`,
        );
      }
    }
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
  if (typeof adapter.type === "string" && !isAdapterType(adapter.type)) {
    const suggestion = findClosestAdapterType(adapter.type);
    const hint = suggestion ? `; did you mean "${suggestion}"?` : "";
    warnConfig(`${path}.type "${adapter.type}" is not a known adapter type${hint}`);
  }
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