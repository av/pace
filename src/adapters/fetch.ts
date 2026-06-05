/** Shared adapter HTTP helpers. Timeouts: DEFAULT 15s, HN_ITEM 10s, FEED 20s, ARXIV 30s.
 *  Errors: `${prefix}: failed to fetch` (non-2xx), `error fetching` (transport), `error reading` (body).
 *  Rethrow `failed to fetch` in outer catches; see `Adapter.fetch` in types.ts. */
import { normalizeXmlList, parseFeedXml, type XmlTextField } from "./atom";
import { errorMessage } from "./types";

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

export type AtomFeedShape<TEntry> = {
  feed?: {
    title?: XmlTextField;
    entry?: TEntry | TEntry[];
  };
};

/** Fetch Atom/XML feed, parse, and normalize `feed.entry` list. */
export async function fetchAtomFeed<TEntry, TParsed extends AtomFeedShape<TEntry>>(
  prefix: string,
  url: string,
  context: string = url,
  options: FetchWithTimeoutOptions = {},
): Promise<{ parsed: TParsed; entries: TEntry[] }> {
  const xml = await fetchText(prefix, url, context, {
    accept: FEED_XML_ACCEPT,
    ...options,
  });
  const parsed = parseFeedXml<TParsed>(xml, prefix, url);
  return { parsed, entries: normalizeXmlList(parsed.feed?.entry) };
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