import { loadBuiltinAdapters } from "./adapter-registry";
import { loadExtensionAdapters } from "./adapter-discovery";
import type { Adapter } from "./types";

const ADAPTERS_DIR = import.meta.dir;

export async function discoverAdapters(): Promise<Map<string, Adapter>> {
  const adapters = loadBuiltinAdapters();
  await loadExtensionAdapters(ADAPTERS_DIR, adapters);
  return adapters;
}