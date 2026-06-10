import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../utils";
import { warnAdapter } from "./empty-config";
import { isAdapterType } from "./params";
import type { Adapter } from "./types";

const DISCOVERY_PREFIX = "discoverAdapters";
const EXCLUDED_EXTENSION_SOURCES = new Set(["types.ts", "index.ts", "adapter-registry.ts"]);

export type ParsedReaddirEntry = { file: string; isFile: boolean };

function adapterFileStem(name: string): string | null {
  const lower = name.toLowerCase();
  if (!lower.endsWith(".ts")) return null;
  return lower.slice(0, -3);
}

/** Normalize a readdir result entry into filename + isFile, or null when corrupt. */
export function parseReaddirEntry(entry: string | Dirent): ParsedReaddirEntry | null {
  if (typeof entry === "string") {
    return { file: entry, isFile: true };
  }
  if (entry && typeof entry.name === "string" && typeof entry.isFile === "function") {
    return { file: entry.name, isFile: entry.isFile() };
  }
  return null;
}

/** True when a filename is a custom extension adapter source (not built-in or support module). */
export function isExtensionAdapterSourceFile(name: string): boolean {
  if (name.startsWith(".")) return false;
  const lower = name.toLowerCase();
  if (EXCLUDED_EXTENSION_SOURCES.has(lower)) return false;
  if (!lower.endsWith(".ts")) return false;
  if (lower.endsWith(".test.ts") || lower.endsWith(".d.ts")) return false;
  const stem = adapterFileStem(name);
  if (stem && isAdapterType(stem)) return false;
  return true;
}

export function isValidAdapter(adapter: unknown): adapter is Adapter {
  if (!adapter || typeof adapter !== "object") return false;
  if (Object.getPrototypeOf(adapter) !== Object.prototype) return false;
  const a = adapter as Adapter;
  if (typeof a.name !== "string" || !a.name.trim() || a.name !== a.name.trim()) return false;
  return typeof a.fetch === "function";
}

/** Scan adaptersDir for custom extension modules and merge into the adapter map. */
export async function loadExtensionAdapters(
  adaptersDir: string,
  adapters: Map<string, Adapter>,
): Promise<void> {
  let files: (string | Dirent)[];
  try {
    files = await readdir(adaptersDir, { withFileTypes: true });
    if (!Array.isArray(files)) {
      warnAdapter(DISCOVERY_PREFIX, `failed to read ${adaptersDir}: non-iterable result`);
      return;
    }
  } catch (err) {
    warnAdapter(DISCOVERY_PREFIX, `failed to read ${adaptersDir}: ${errorMessage(err)}`);
    return;
  }

  for (const entry of files) {
    const parsed = parseReaddirEntry(entry);
    if (!parsed) {
      warnAdapter(DISCOVERY_PREFIX, "skipped invalid readdir entry");
      continue;
    }
    const { file, isFile } = parsed;
    if (!isFile || !isExtensionAdapterSourceFile(file)) continue;

    try {
      const mod = await import(join(adaptersDir, file));
      const adapter: unknown = mod.default;
      if (adapter === undefined) continue;
      if (!isValidAdapter(adapter)) {
        warnAdapter(
          DISCOVERY_PREFIX,
          `skipped ${file} (invalid default export: plain object with trimmed name and fetch)`,
        );
        continue;
      }
      if (adapters.has(adapter.name)) {
        warnAdapter(
          DISCOVERY_PREFIX,
          `duplicate adapter "${adapter.name}" in ${file} (overwrites previous; check config source types)`,
        );
      }
      adapters.set(adapter.name, adapter);
    } catch (err) {
      warnAdapter(DISCOVERY_PREFIX, `failed to import ${file}: ${errorMessage(err)}`);
    }
  }
}