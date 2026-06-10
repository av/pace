import type { ContentItem } from "./types";

/** Prefix a message with adapter name and log as warning. */
export function warnAdapter(adapterName: string, message: string): void {
  console.warn(`${adapterName}: ${message}`);
}

/** Log adapter empty-config warning and return no items. */
export function warnEmptyConfig(adapterName: string, reason: string): ContentItem[] {
  warnAdapter(adapterName, reason);
  return [];
}

/** Warn when a config param has no effect unless another param is set. */
export function warnIneffectiveParam(
  adapterName: string,
  param: string,
  requirement: string,
): void {
  warnAdapter(adapterName, `${param} has no effect without ${requirement}`);
}

/** Warn when user input fails validation (invalid handle, malformed value, etc). */
export function warnInvalidInput(
  adapterName: string,
  kind: string,
  detail: string,
): void {
  warnAdapter(adapterName, `invalid ${kind}: ${detail}`);
}

/** Warn when a fetch succeeded structurally but returned no usable data. */
export function warnEmptyFetchResult(
  adapterName: string,
  resource: string,
  location: string,
): void {
  warnAdapter(adapterName, `no ${resource} found on ${location}`);
}

/** Warn when an expected section of a fetched payload is absent or empty. */
export function warnEmptySection(
  adapterName: string,
  source: string,
  section: string,
): void {
  warnAdapter(adapterName, `${source} has no ${section}`);
}

/** Warn when a post-fetch filter removed every item from a non-empty set. */
export function warnFilterRemovedAll(
  adapterName: string,
  filterName: string,
  filterValue: string | number,
  totalCount: number,
  itemLabel = "item(s)",
): void {
  warnAdapter(
    adapterName,
    `${filterName} (${filterValue}) filtered all ${totalCount} ${itemLabel}`,
  );
}