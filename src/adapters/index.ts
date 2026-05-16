import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Adapter } from "./types";

const EXCLUDED = new Set(["types.ts", "index.ts"]);

export async function discoverAdapters(): Promise<Map<string, Adapter>> {
  const adapters = new Map<string, Adapter>();
  const dir = join(import.meta.dir);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return adapters;
  }

  for (const file of files) {
    if (!file.endsWith(".ts") || EXCLUDED.has(file)) continue;

    try {
      const mod = await import(join(dir, file));
      const adapter: Adapter = mod.default;
      if (adapter && adapter.name && typeof adapter.fetch === "function") {
        adapters.set(adapter.name, adapter);
      }
    } catch (err) {
      console.warn(`failed to load adapter ${file}:`, err);
    }
  }

  return adapters;
}
