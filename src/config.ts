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
  transforms?: TransformConfig[];
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

// --- Top-level ---

export interface AppConfig {
  adapters: AdapterConfig[];
  layout: LayoutNodeConfig;
  llm?: LlmConfig;
}

// --- Helpers ---

function defaultLayout(): LayoutNodeConfig {
  return {
    direction: "row",
    children: [{ panel: "all", source: "all", transforms: [{ type: "latest", count: 50 }] }],
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

export function isPanel(node: LayoutNodeConfig): node is PanelConfig {
  return "panel" in node;
}

export function isContainer(node: LayoutNodeConfig): node is FlexContainerConfig {
  return "direction" in node && "children" in node;
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
  return node.children.flatMap(collectPanels);
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
    console.warn("config: failed to parse YAML, using defaults:", err);
    return defaultConfig();
  }

  if (!parsed || typeof parsed !== "object") {
    return defaultConfig();
  }

  const resolved = resolveEnvInObject(parsed) as Record<string, unknown>;
  const adapters: AdapterConfig[] = Array.isArray(resolved.adapters) ? resolved.adapters : [];
  const layout = resolved.layout ? resolved.layout as LayoutNodeConfig : defaultLayout();

  validatePanelIds(layout);

  return {
    adapters,
    layout,
    llm: resolved.llm as LlmConfig | undefined,
  };
}
