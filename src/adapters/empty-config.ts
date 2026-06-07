import type { ContentItem } from "./types";

/** Log adapter empty-config warning and return no items. */
export function warnEmptyConfig(adapterName: string, reason: string): ContentItem[] {
  console.warn(`${adapterName}: ${reason}`);
  return [];
}