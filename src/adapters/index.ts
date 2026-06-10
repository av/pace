import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../utils";
import { loadBuiltinAdapters } from "./adapter-registry";
import { warnAdapter } from "./empty-config";
import { isAdapterType } from "./params";
import type { Adapter } from "./types";

const EXCLUDED = new Set(["types.ts", "index.ts", "adapter-registry.ts"]);
const ADAPTERS_DIR = import.meta.dir;

function adapterFileStem(name: string): string | null {
  const lower = name.toLowerCase();
  if (!lower.endsWith(".ts")) return null;
  return lower.slice(0, -3);
}

function isExtensionAdapterSourceFile(name: string): boolean {
  if (name.startsWith(".")) return false;
  const lower = name.toLowerCase();
  if (EXCLUDED.has(lower)) return false;
  if (!lower.endsWith(".ts")) return false;
  if (lower.endsWith(".test.ts") || lower.endsWith(".d.ts")) return false;
  const stem = adapterFileStem(name);
  if (stem && isAdapterType(stem)) return false;
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
  const adapters = loadBuiltinAdapters();

  let files: (string | Dirent)[];
  try {
    files = await readdir(ADAPTERS_DIR, { withFileTypes: true });
    if (!Array.isArray(files)) {
      warnAdapter("discoverAdapters", `failed to read ${ADAPTERS_DIR}: non-iterable result`);
      return adapters;
    }
  } catch (err) {
    warnAdapter("discoverAdapters", `failed to read ${ADAPTERS_DIR}: ${errorMessage(err)}`);
    return adapters;
  }

  for (const entry of files) {
    const parsed = parseReaddirEntry(entry);
    if (!parsed) {
      warnAdapter("discoverAdapters", "skipped invalid readdir entry");
      continue;
    }
    const { file, isFile } = parsed;
    if (!isFile || !isExtensionAdapterSourceFile(file)) continue;

    try {
      const mod = await import(join(ADAPTERS_DIR, file));
      const adapter: unknown = mod.default;
      if (adapter === undefined) continue;
      if (!isValidAdapter(adapter)) {
        warnAdapter(
          "discoverAdapters",
          `skipped ${file} (invalid default export: plain object with trimmed name and fetch)`,
        );
        continue;
      }
      if (adapters.has(adapter.name)) {
        warnAdapter(
          "discoverAdapters",
          `duplicate adapter "${adapter.name}" in ${file} (overwrites previous; check config source types)`,
        );
      }
      adapters.set(adapter.name, adapter);
    } catch (err) {
      warnAdapter("discoverAdapters", `failed to import ${file}: ${errorMessage(err)}`);
    }
  }

  return adapters;
}