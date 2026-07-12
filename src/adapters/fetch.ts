/** Shared adapter HTTP helpers. Timeouts: DEFAULT 15s, HN_ITEM 10s, FEED 20s, ARXIV 30s.
 *  Errors: `${prefix}: failed to fetch` (non-2xx), `error fetching` (transport), `error reading` (body).
 *  Rethrow `failed to fetch` in outer catches; see `Adapter.fetch` in types.ts. */
import type { XMLParser } from "fast-xml-parser";
import {
  extractRssAtomItems,
  parseFeedXml,
  parseXml,
  shouldWarnLegitimatelyEmptyFeed,
  type XmlTextField,
} from "./atom";
import { errorMessage, redactSensitiveUrlCredentials } from "../utils";
import {
  warnEmptyFeedEntries,
  warnMalformedArrayField,
  warnMalformedJsonArray,
  warnMalformedJsonObject,
  warnMalformedObjectField,
  warnOptionalFetchFailure,
  warnSkippedInvalidArrayElements,
  warnSkippedNonNumericArrayElements,
} from "./empty-config";

export const PACE_USER_AGENT = "pace/1.0";
export const PACE_FEED_USER_AGENT =
  "pace:feed-aggregator/1.0 (github.com/everlier/pace)";
export const GITHUB_API_ACCEPT = "application/vnd.github+json";
export const FEED_XML_ACCEPT =
  "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";

export function buildGitHubApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: GITHUB_API_ACCEPT };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
export const HN_ITEM_FETCH_TIMEOUT_MS = 10_000;
export const FEED_FETCH_TIMEOUT_MS = 20_000;
export const ARXIV_FETCH_TIMEOUT_MS = 30_000;

function buildFetchHeaders(options: FetchWithTimeoutOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": options.userAgent ?? PACE_FEED_USER_AGENT,
    ...options.headers,
  };
  if (options.accept) {
    headers.Accept = options.accept;
  }
  return headers;
}

export type FetchWithTimeoutOptions = {
  timeoutMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  accept?: string;
};

type FetchBodyReader<T> = (res: Response) => Promise<T>;

/** Does not check `res.ok` - use `fetchText` / `fetchJson` for status handling. */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  return fetch(url, {
    headers: buildFetchHeaders(options),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function fetchOkResponse(
  prefix: string,
  url: string,
  context: string,
  options: FetchWithTimeoutOptions,
): Promise<Response> {
  const safeContext = redactSensitiveUrlCredentials(context);
  let res: Response;
  try {
    res = await fetchWithTimeout(url, options);
  } catch (err) {
    throw new Error(
      `${prefix}: error fetching ${safeContext}: ${redactSensitiveUrlCredentials(errorMessage(err))}`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `${prefix}: failed to fetch ${safeContext}: HTTP error ${res.status}`,
    );
  }

  return res;
}

async function fetchBody<T>(
  prefix: string,
  url: string,
  context: string,
  options: FetchWithTimeoutOptions,
  read: FetchBodyReader<T>,
): Promise<T> {
  const safeContext = redactSensitiveUrlCredentials(context);
  const res = await fetchOkResponse(prefix, url, context, options);
  try {
    return await read(res);
  } catch (err) {
    throw new Error(
      `${prefix}: error reading ${safeContext}: ${redactSensitiveUrlCredentials(errorMessage(err))}`,
    );
  }
}

export async function fetchText(
  prefix: string,
  url: string,
  context: string = url,
  options: FetchWithTimeoutOptions = {},
): Promise<string> {
  return fetchBody(prefix, url, context, options, (res) => res.text());
}

export async function fetchJson<T>(
  prefix: string,
  url: string,
  context: string = url,
  options: FetchWithTimeoutOptions = {},
): Promise<T> {
  return fetchBody(prefix, url, context, options, async (res) => (await res.json()) as T);
}

function finalizeFeedItemList<TEntry, TParsed extends RssAtomFeedShape<TEntry>>(
  prefix: string,
  context: string,
  parsed: TParsed,
  items: TEntry[],
): TEntry[] {
  if (shouldWarnLegitimatelyEmptyFeed(parsed, items)) {
    warnEmptyFeedEntries(prefix, context);
  }
  return items;
}

/**
 * Read a required array field from a JSON object response.
 * Returns [] and warns when the parent is not an object, the field is missing,
 * or the field is present but not an array. Legitimate empty arrays pass through silently.
 */
export function arrayFieldOrEmpty<T>(
  prefix: string,
  record: unknown,
  field: string,
  context: string,
): T[] {
  if (record == null || typeof record !== "object") {
    warnMalformedArrayField(prefix, field, context, "response is not an object");
    return [];
  }
  const value = (record as Record<string, unknown>)[field];
  if (value == null) {
    warnMalformedArrayField(prefix, field, context, "field is missing");
    return [];
  }
  if (!Array.isArray(value)) {
    warnMalformedArrayField(prefix, field, context, `got ${typeof value}`);
    return [];
  }
  return value as T[];
}

/**
 * Validate a top-level JSON array response (e.g. Dev.to articles list).
 * Returns [] and warns when the payload is not an array. Empty arrays pass through silently.
 */
export function jsonArrayOrEmpty<T>(
  prefix: string,
  value: unknown,
  context: string,
): T[] {
  if (!Array.isArray(value)) {
    warnMalformedJsonArray(
      prefix,
      context,
      value == null ? "response is null/undefined" : `got ${typeof value}`,
    );
    return [];
  }
  return value as T[];
}

/**
 * Resolve a required-field path on a record. Supports dot paths ("post.id",
 * "account.acct") so nested API shapes can be validated; each intermediate
 * segment must be a plain object.
 */
function resolveRequiredFieldPath(
  record: Record<string, unknown>,
  field: string,
): unknown {
  let current: unknown = record;
  for (const segment of field.split(".")) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function missingRequiredJsonObjectFields(
  record: Record<string, unknown>,
  requiredFields: readonly string[],
): string[] {
  return requiredFields.filter((field) => {
    const fieldValue = resolveRequiredFieldPath(record, field);
    return (
      fieldValue == null ||
      (typeof fieldValue === "string" && fieldValue.length === 0)
    );
  });
}

function isValidJsonObjectElement(
  element: unknown,
  requiredFields: readonly string[],
): element is Record<string, unknown> {
  if (element == null || typeof element !== "object" || Array.isArray(element)) {
    return false;
  }
  const record = element as Record<string, unknown>;
  return missingRequiredJsonObjectFields(record, requiredFields).length === 0;
}

/**
 * Validate a top-level JSON object response (e.g. Mastodon account lookup).
 * Returns null and warns when the payload is not an object or required fields are absent.
 */
export function jsonObjectOrNull<T extends object>(
  prefix: string,
  value: unknown,
  context: string,
  requiredFields: readonly string[] = [],
): T | null {
  if (value == null) {
    warnMalformedJsonObject(
      prefix,
      context,
      "response is null/undefined",
    );
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    warnMalformedJsonObject(
      prefix,
      context,
      Array.isArray(value) ? "got array" : `got ${typeof value}`,
    );
    return null;
  }
  const record = value as Record<string, unknown>;
  const missing = missingRequiredJsonObjectFields(record, requiredFields);
  if (missing.length > 0) {
    warnMalformedJsonObject(
      prefix,
      context,
      `missing required field(s): ${missing.join(", ")}`,
    );
    return null;
  }
  return value as T;
}

function filterValidObjectArrayElements<T extends object>(
  prefix: string,
  raw: unknown[],
  context: string,
  requiredFields: readonly string[],
): T[] {
  if (raw.length === 0) return [];

  const valid: T[] = [];
  let skipped = 0;
  for (const element of raw) {
    if (isValidJsonObjectElement(element, requiredFields)) {
      valid.push(element as T);
    } else {
      skipped++;
    }
  }
  if (skipped > 0) {
    warnSkippedInvalidArrayElements(prefix, context, skipped, raw.length, requiredFields);
  }
  return valid;
}

/**
 * Validate a top-level JSON array of objects with required fields (e.g. Mastodon statuses).
 * Non-array payloads warn via jsonArrayOrEmpty; invalid elements are filtered with a warn.
 */
export function jsonObjectArrayOrEmpty<T extends object>(
  prefix: string,
  value: unknown,
  context: string,
  requiredFields: readonly string[],
): T[] {
  const raw = jsonArrayOrEmpty<unknown>(prefix, value, context);
  return filterValidObjectArrayElements<T>(prefix, raw, context, requiredFields);
}

/**
 * Read a required array field from a JSON object response AND validate each
 * element as an object with the given required (dot-path capable) fields.
 * Combines arrayFieldOrEmpty with per-element filtering (e.g. Lemmy post views):
 * malformed elements are skipped with a warn instead of crashing downstream code.
 */
export function objectArrayFieldOrEmpty<T extends object>(
  prefix: string,
  record: unknown,
  field: string,
  context: string,
  requiredFields: readonly string[],
): T[] {
  const raw = arrayFieldOrEmpty<unknown>(prefix, record, field, context);
  return filterValidObjectArrayElements<T>(prefix, raw, context, requiredFields);
}

/**
 * Validate a top-level JSON array of finite integers (e.g. Hacker News story IDs).
 * Non-array payloads warn via jsonArrayOrEmpty; non-integer elements are filtered with a warn.
 */
export function jsonNumericArrayOrEmpty(
  prefix: string,
  value: unknown,
  context: string,
): number[] {
  const raw = jsonArrayOrEmpty<unknown>(prefix, value, context);
  if (raw.length === 0) return [];

  const numeric: number[] = [];
  let skipped = 0;
  for (const element of raw) {
    if (typeof element === "number" && Number.isInteger(element)) {
      numeric.push(element);
    } else {
      skipped++;
    }
  }
  if (skipped > 0) {
    warnSkippedNonNumericArrayElements(prefix, context, skipped, raw.length);
  }
  return numeric;
}

/**
 * Read an optional array field from a JSON object response (e.g. Wikipedia featured
 * feed sections that may be absent on a given day).
 * Returns [] silently when the parent or field is null/undefined. Warns when the
 * parent is present but not an object, or the field is present but not an array.
 */
export function optionalArrayFieldOrEmpty<T>(
  prefix: string,
  record: unknown,
  field: string,
  context: string,
): T[] {
  if (record == null) return [];
  if (typeof record !== "object") {
    warnMalformedArrayField(prefix, field, context, "parent is not an object");
    return [];
  }
  const value = (record as Record<string, unknown>)[field];
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnMalformedArrayField(prefix, field, context, `got ${typeof value}`);
    return [];
  }
  return value as T[];
}

/**
 * Read an optional array field of objects with required keys (e.g. Wikipedia featured
 * feed sections). Absent parent/field stays silent like optionalArrayFieldOrEmpty;
 * malformed shapes warn; invalid elements are filtered with a warn.
 */
export function optionalObjectArrayFieldOrEmpty<T extends object>(
  prefix: string,
  record: unknown,
  field: string,
  context: string,
  requiredFields: readonly string[],
): T[] {
  const raw = optionalArrayFieldOrEmpty<unknown>(prefix, record, field, context);
  return filterValidObjectArrayElements<T>(prefix, raw, context, requiredFields);
}

/**
 * Read an optional object field from a JSON object response (e.g. Wikipedia tfa).
 * Returns null silently when the parent or field is null/undefined. Warns when the
 * parent is present but not an object, the field is present but not an object, or
 * required fields are missing.
 */
export function optionalObjectFieldOrNull<T extends object>(
  prefix: string,
  record: unknown,
  field: string,
  context: string,
  requiredFields: readonly string[],
): T | null {
  if (record == null) return null;
  if (typeof record !== "object") {
    warnMalformedObjectField(prefix, field, context, "parent is not an object");
    return null;
  }
  const value = (record as Record<string, unknown>)[field];
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    warnMalformedObjectField(
      prefix,
      field,
      context,
      Array.isArray(value) ? "got array" : `got ${typeof value}`,
    );
    return null;
  }
  const missing = missingRequiredJsonObjectFields(
    value as Record<string, unknown>,
    requiredFields,
  );
  if (missing.length > 0) {
    warnMalformedObjectField(
      prefix,
      field,
      context,
      `missing required field(s): ${missing.join(", ")}`,
    );
    return null;
  }
  return value as T;
}

export type AtomFeedShape<TEntry> = {
  feed?: {
    title?: XmlTextField;
    entry?: TEntry | TEntry[];
  };
};

export type RssAtomFeedShape<TEntry> = {
  rss?: {
    channel?: {
      title?: XmlTextField;
      item?: TEntry | TEntry[];
    };
  };
  feed?: {
    title?: XmlTextField;
    entry?: TEntry | TEntry[];
  };
};

export type FetchFeedXmlOptions = FetchWithTimeoutOptions & {
  parser?: XMLParser;
};

/** Fetch feed XML with FEED_XML_ACCEPT and parse with the shared or custom parser. */
async function fetchAndParseFeedXml<TParsed>(
  prefix: string,
  url: string,
  context: string,
  options: FetchFeedXmlOptions = {},
): Promise<TParsed> {
  const { parser, ...fetchOptions } = options;
  const xml = await fetchText(prefix, url, context, {
    accept: FEED_XML_ACCEPT,
    ...fetchOptions,
  });
  return parser
    ? parseXml<TParsed>(xml, parser, prefix, url)
    : parseFeedXml<TParsed>(xml, prefix, url);
}

/** Fetch Atom/XML feed, parse, and normalize `feed.entry` list. */
export async function fetchAtomFeed<TEntry, TParsed extends AtomFeedShape<TEntry>>(
  prefix: string,
  url: string,
  context: string = url,
  options: FetchWithTimeoutOptions = {},
): Promise<{ parsed: TParsed; entries: TEntry[] }> {
  const parsed = await fetchAndParseFeedXml<TParsed>(prefix, url, context, options);
  const entries = extractRssAtomItems(parsed, { prefix, context });
  return {
    parsed,
    entries: finalizeFeedItemList(prefix, context, parsed, entries),
  };
}

export type FetchRssAtomFeedOptions = FetchFeedXmlOptions;

/** Fetch RSS/Atom feed XML, parse, and normalize items (`rss.channel.item` or `feed.entry`). */
export async function fetchRssAtomFeed<
  TEntry,
  TParsed extends RssAtomFeedShape<TEntry>,
>(
  prefix: string,
  url: string,
  context: string = url,
  options: FetchRssAtomFeedOptions = {},
): Promise<{ parsed: TParsed; items: TEntry[] }> {
  const parsed = await fetchAndParseFeedXml<TParsed>(prefix, url, context, options);
  const items = extractRssAtomItems(parsed, { prefix, context });
  return {
    parsed,
    items: finalizeFeedItemList(prefix, context, parsed, items),
  };
}

/** Run an optional secondary fetch; warn and return null on failure. */
export async function tryOptionalFetch<T>(
  prefix: string,
  context: string,
  work: () => Promise<T>,
): Promise<T | null> {
  try {
    return await work();
  } catch (err) {
    warnOptionalFetchFailure(prefix, err, context);
    return null;
  }
}
