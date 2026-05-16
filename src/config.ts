import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { AdapterConfig } from "./adapters/types";

export interface LlmDigestConfig {
  max_length?: number;
  style?: "brief" | "detailed";
  focus_areas?: string[];
}

export interface LlmConfig {
  provider?: string;
  model?: string;
  api_key?: string;
  base_url?: string;
  digest?: LlmDigestConfig;
  interests?: string[];
}

export interface LayoutConfig {
  panels?: string[];
}

export interface AppConfig {
  adapters: AdapterConfig[];
  layout: LayoutConfig;
  llm?: LlmConfig;
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

export function loadConfig(): AppConfig {
  const configPath = join(process.cwd(), "config.yaml");
  const examplePath = join(process.cwd(), "config.example.yaml");

  let raw: string;
  if (existsSync(configPath)) {
    raw = readFileSync(configPath, "utf-8");
  } else if (existsSync(examplePath)) {
    raw = readFileSync(examplePath, "utf-8");
  } else {
    return {
      adapters: [],
      layout: { panels: ["all"] },
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (err) {
    console.warn("config: failed to parse YAML, using defaults:", err);
    return { adapters: [], layout: { panels: ["all"] } };
  }

  if (!parsed || typeof parsed !== "object") {
    return { adapters: [], layout: { panels: ["all"] } };
  }

  const resolved = resolveEnvInObject(parsed) as Record<string, unknown>;

  const rawLayout = resolved.layout as LayoutConfig | undefined;

  return {
    adapters: Array.isArray(resolved.adapters) ? resolved.adapters : [],
    layout: {
      panels: Array.isArray(rawLayout?.panels) ? rawLayout.panels : ["all"],
    },
    llm: resolved.llm as LlmConfig | undefined,
  };
}
