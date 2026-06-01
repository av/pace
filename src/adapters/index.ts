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
  } catch (err) {
    console.warn(`failed to read adapters dir ${dir}:`, err);
    return adapters;
  }

  for (const file of files) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file.startsWith(".") || EXCLUDED.has(file)) continue;

    try {
      const mod = await import(join(dir, file));
      const adapter: Adapter = mod.default;
      if (adapter && typeof adapter === "object" && adapter !== null && Object.getPrototypeOf(adapter) === Object.prototype && typeof adapter.name === "string" && adapter.name === adapter.name.trim() && adapter.name.trim() && typeof adapter.fetch === "function") {
        if (adapters.has(adapter.name)) {
          console.warn(`duplicate adapter name "${adapter.name}" from ${file} (overwriting previous; check for name clashes at runtime vs config names)`);
        }
        adapters.set(adapter.name, adapter);
      } else {
        console.warn(`bad mod filter: skipped non-conforming module ${file} (invalid default export shape per ngb)`);
      }
    } catch (err) {
      console.warn(`import error: failed to load adapter ${file}:`, err);
    }
  }

  return adapters;
}
