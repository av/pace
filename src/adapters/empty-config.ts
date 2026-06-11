import type { ContentItem } from "./types";
import { errorMessage } from "../utils";

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

/** Warn when a JSON response field should be an array but has wrong shape. */
export function warnMalformedArrayField(
  adapterName: string,
  field: string,
  context: string,
  detail: string,
): void {
  warnAdapter(
    adapterName,
    `expected array field "${field}" for ${context} (${detail}), treating as empty`,
  );
}

/** Warn when a top-level JSON response should be an array but has wrong shape. */
export function warnMalformedJsonArray(
  adapterName: string,
  context: string,
  detail: string,
): void {
  warnAdapter(
    adapterName,
    `expected JSON array for ${context} (${detail}), treating as empty`,
  );
}

/** Warn when a top-level JSON response should be an object but has wrong shape. */
export function warnMalformedJsonObject(
  adapterName: string,
  context: string,
  detail: string,
): void {
  warnAdapter(
    adapterName,
    `expected JSON object for ${context} (${detail}), treating as null`,
  );
}

/** Warn when a JSON array contains non-numeric elements that were filtered out. */
export function warnSkippedNonNumericArrayElements(
  adapterName: string,
  context: string,
  skipped: number,
  total: number,
): void {
  warnAdapter(
    adapterName,
    `skipped ${skipped} non-numeric element(s) in ${context} (${total} total)`,
  );
}

/** Warn when a JSON array contains elements that failed object shape validation. */
export function warnSkippedInvalidArrayElements(
  adapterName: string,
  context: string,
  skipped: number,
  total: number,
  requiredFields: readonly string[],
): void {
  const fields =
    requiredFields.length > 0 ? `; required: ${requiredFields.join(", ")}` : "";
  warnAdapter(
    adapterName,
    `skipped ${skipped} invalid element(s) in ${context} (${total} total${fields})`,
  );
}

/** Warn when a feed XML field should be an item/entry list but has wrong shape. */
export function warnMalformedFeedField(
  adapterName: string,
  field: string,
  context: string,
  detail: string,
): void {
  warnAdapter(
    adapterName,
    `expected feed field "${field}" for ${context} (${detail}), treating as empty`,
  );
}

/** Warn when a feed fetch succeeded but returned no items. */
export function warnEmptyFeedEntries(adapterName: string, context: string): void {
  warnAdapter(adapterName, `no entries found in ${context}`);
}

/** Warn when date parsing falls back to current time. */
export function warnDateParseFallback(kind: string, detail: string): void {
  warnAdapter("dates", `${kind} ${detail}, using current time`);
}

/**
 * Warn on optional secondary fetch failure (enrichment, account lookup, per-item
 * JSON). Passes through errors already prefixed with `${adapterName}:`; otherwise
 * logs `${adapterName}: ${context}: ${detail}`.
 */
export function warnOptionalFetchFailure(
  adapterName: string,
  detail: unknown,
  context: string,
): void {
  const msg = errorMessage(detail);
  if (msg.startsWith(`${adapterName}:`)) {
    console.warn(msg);
    return;
  }
  warnAdapter(adapterName, `${context}: ${msg}`);
}