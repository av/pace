/**
 * Shared HTTP helpers for adapters (`fetchWithTimeout`, `fetchText`, `fetchJson`).
 *
 * Adapter-specific `timeoutMs` overrides (omit when equal to `DEFAULT_FETCH_TIMEOUT_MS`):
 *
 * - **15s** (`DEFAULT_FETCH_TIMEOUT_MS`) — default for most feed/API calls.
 * - **10s** (`HN_ITEM_FETCH_TIMEOUT_MS`) — hackernews per-item (`item/{id}.json`);
 *   mastodon account lookup; producthunt enrich HTML scrape.
 * - **20s** (`FEED_FETCH_TIMEOUT_MS`) — github trending HTML; podcast feed XML.
 * - **30s** (`ARXIV_FETCH_TIMEOUT_MS`) — arxiv Atom query.
 *
 * Error message prefixes (use `${adapterName}:` consistently):
 *
 * - **`failed to fetch`** — the request completed but the response is unusable:
 *   non-2xx HTTP (`!res.ok`). Throw this directly after status check; do not
 *   wrap it again in an outer catch.
 * - **`error fetching`** — transport-layer failure before a definitive HTTP
 *   status: network errors, DNS, timeouts (`AbortSignal.timeout`), etc. Emitted
 *   by `fetchText`/`fetchJson` via `fetchOkResponse` / `fetchBody`.
 * - **`error reading`** — `res.ok` but reading/parsing the body failed.
 *
 * Avoid double-wrapped messages (`error fetching … failed to fetch …`): in a
 * catch-all around fetch+parse, rethrow when
 * `err.message.startsWith(\`${prefix}: failed to fetch\`)`; otherwise wrap as
 * `error fetching`. See `Adapter.fetch` in `types.ts` for throw vs warn+[] contract.
 */
import { errorMessage } from "./types";

export const PACE_USER_AGENT = "pace/1.0";
export const PACE_FEED_USER_AGENT =
  "pace:feed-aggregator/1.0 (github.com/everlier/pace)";
export const GITHUB_API_ACCEPT = "application/vnd.github+json";

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