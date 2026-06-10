/** Shared adapter HTTP helpers. Timeouts: DEFAULT 15s, HN_ITEM 10s, FEED 20s, ARXIV 30s.
 *  Errors: `${prefix}: failed to fetch` (non-2xx), `error fetching` (transport), `error reading` (body).
 *  Rethrow `failed to fetch` in outer catches; see `Adapter.fetch` in types.ts. */
import type { XMLParser } from "fast-xml-parser";
import {
  extractRssAtomItems,
  parseFeedXml,
  parseXml,
  type XmlTextField,
} from "./atom";
import { errorMessage } from "../utils";

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

/** Does not check `res.ok` — use `fetchText` / `fetchJson` for status handling. */
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
  let res: Response;
  try {
    res = await fetchWithTimeout(url, options);
  } catch (err) {
    throw new Error(`${prefix}: error fetching ${context}: ${errorMessage(err)}`);
  }

  if (!res.ok) {
    throw new Error(
      `${prefix}: failed to fetch ${context}: ${errorMessage({ message: `HTTP error ${res.status}` })}`,
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
  const res = await fetchOkResponse(prefix, url, context, options);
  try {
    return await read(res);
  } catch (err) {
    throw new Error(`${prefix}: error reading ${context}: ${errorMessage(err)}`);
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

function warnArrayFieldShape(
  prefix: string,
  field: string,
  context: string,
  detail: string,
): void {
  console.warn(
    `${prefix}: expected array field "${field}" for ${context} (${detail}), treating as empty`,
  );
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
    warnArrayFieldShape(prefix, field, context, "response is not an object");
    return [];
  }
  const value = (record as Record<string, unknown>)[field];
  if (value == null) {
    warnArrayFieldShape(prefix, field, context, "field is missing");
    return [];
  }
  if (!Array.isArray(value)) {
    warnArrayFieldShape(prefix, field, context, `got ${typeof value}`);
    return [];
  }
  return value as T[];
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
    warnArrayFieldShape(prefix, field, context, "parent is not an object");
    return [];
  }
  const value = (record as Record<string, unknown>)[field];
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnArrayFieldShape(prefix, field, context, `got ${typeof value}`);
    return [];
  }
  return value as T[];
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
  return {
    parsed,
    entries: extractRssAtomItems(parsed, { prefix, context }),
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
  return {
    parsed,
    items: extractRssAtomItems(parsed, { prefix, context }),
  };
}

/**
 * Warn on optional secondary fetch failure (enrichment, account lookup, per-item
 * JSON). Passes through errors already prefixed with `${prefix}:`; otherwise logs
 * `${prefix}: ${context}: ${detail}`.
 */
export function warnOptionalFetchFailure(
  prefix: string,
  detail: unknown,
  context: string,
): void {
  const msg = errorMessage(detail);
  console.warn(
    msg.startsWith(`${prefix}:`) ? msg : `${prefix}: ${context}: ${msg}`,
  );
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