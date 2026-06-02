/**
 * Shared HTTP helpers for adapters (`fetchWithTimeout`, `fetchText`, `fetchJson`).
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

/** Short UA for tests and rare overrides (e.g. podcast). */
export const PACE_USER_AGENT = "pace/1.0";

/** Default for adapter HTTP — APIs that require an identifiable client string. */
export const PACE_FEED_USER_AGENT =
  "pace:feed-aggregator/1.0 (github.com/everlier/pace)";

/** GitHub REST API `Accept` value (api.github.com JSON responses). */
export const GITHUB_API_ACCEPT = "application/vnd.github+json";

/** Headers for GitHub REST API requests (`Accept` + optional `Authorization`). */
export function buildGitHubApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: GITHUB_API_ACCEPT };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

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

/**
 * HTTP fetch with default User-Agent and AbortSignal.timeout.
 * Does not check res.ok — callers handle status or use fetchText/fetchJson.
 */
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

/** Fetch URL as text; applies the module error-prefix conventions above. */
export async function fetchText(
  prefix: string,
  url: string,
  context: string = url,
  options: FetchWithTimeoutOptions = {},
): Promise<string> {
  return fetchBody(prefix, url, context, options, (res) => res.text());
}

/** Fetch URL as JSON; applies the module error-prefix conventions above. */
export async function fetchJson<T>(
  prefix: string,
  url: string,
  context: string = url,
  options: FetchWithTimeoutOptions = {},
): Promise<T> {
  return fetchBody(prefix, url, context, options, async (res) => (await res.json()) as T);
}