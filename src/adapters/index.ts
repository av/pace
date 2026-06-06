import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../utils";
import type { Adapter } from "./types";

const EXCLUDED = new Set(["types.ts", "index.ts"]);
/** Shared modules co-located with adapters; not default-export adapters. */
const ADAPTER_SUPPORT_MODULES = new Set([
  "atom.ts",
  "dates.ts",
  "engagement.ts",
  "fetch.ts",
  "github-repo-meta.ts",
  "github-shared.ts",
  "html.ts",
  "merge.ts",
  "params.ts",
  "title.ts",
]);
const ADAPTERS_DIR = import.meta.dir;

function warnDiscover(detail: string): void {
  console.warn(`discoverAdapters: ${detail}`);
}

function isAdapterSourceFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (name.startsWith(".") || EXCLUDED.has(lower)) return false;
  if (!lower.endsWith(".ts")) return false;
  if (lower.endsWith(".test.ts") || lower.endsWith(".d.ts")) return false;
  if (ADAPTER_SUPPORT_MODULES.has(lower)) return false;
  return true;
}

function parseReaddirEntry(entry: string | Dirent): { file: string; isFile: boolean } | null {
  if (typeof entry === "string") {
    return { file: entry, isFile: true };
  }
  if (entry && typeof entry.name === "string" && typeof entry.isFile === "function") {
    return { file: entry.name, isFile: entry.isFile() };
  }
  return null;
}

function isValidAdapter(adapter: unknown): adapter is Adapter {
  if (!adapter || typeof adapter !== "object") return false;
  if (Object.getPrototypeOf(adapter) !== Object.prototype) return false;
  const a = adapter as Adapter;
  if (typeof a.name !== "string" || !a.name.trim() || a.name !== a.name.trim()) return false;
  return typeof a.fetch === "function";
}

export async function discoverAdapters(): Promise<Map<string, Adapter>> {
  const adapters = new Map<string, Adapter>();

  let files: (string | Dirent)[];
  try {
    files = await readdir(ADAPTERS_DIR, { withFileTypes: true });
    if (!Array.isArray(files)) {
      warnDiscover(`failed to read ${ADAPTERS_DIR}: non-iterable result`);
      return adapters;
    }
  } catch (err) {
    warnDiscover(`failed to read ${ADAPTERS_DIR}: ${errorMessage(err)}`);
    return adapters;
  }

  for (const entry of files) {
    const parsed = parseReaddirEntry(entry);
    if (!parsed) {
      warnDiscover("skipped invalid readdir entry");
      continue;
    }
    const { file, isFile } = parsed;
    if (!isFile || !isAdapterSourceFile(file)) continue;

    try {
      const mod = await import(join(ADAPTERS_DIR, file));
      const adapter: unknown = mod.default;
      if (!isValidAdapter(adapter)) {
        warnDiscover(
          `skipped ${file} (invalid default export: plain object with trimmed name and fetch)`
        );
        continue;
      }
      if (adapters.has(adapter.name)) {
        warnDiscover(
          `duplicate adapter "${adapter.name}" in ${file} (overwrites previous; check config source types)`
        );
      }
      adapters.set(adapter.name, adapter);
    } catch (err) {
      warnDiscover(`failed to import ${file}: ${errorMessage(err)}`);
    }
  }

  return adapters;
}