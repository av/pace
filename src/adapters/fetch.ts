/**
 * Shared HTTP helpers for adapters (`fetchWithTimeout`, `fetchText`).
 *
 * Error message prefixes (use `${adapterName}:` consistently):
 *
 * - **`failed to fetch`** — the request completed but the response is unusable:
 *   non-2xx HTTP (`!res.ok`). Throw this directly after status check; do not
 *   wrap it again in an outer catch.
 * - **`error fetching`** — transport-layer failure before a definitive HTTP
 *   status: network errors, DNS, timeouts (`AbortSignal.timeout`), etc. Use in
 *   catch blocks around `fetchWithTimeout` / `res.text()`.
 * - **`error reading`** — `res.ok` but reading the body failed (`fetchText` only).
 *
 * Avoid double-wrapped messages (`error fetching … failed to fetch …`): in a
 * catch-all around fetch+parse, rethrow when
 * `err.message.startsWith(\`${prefix}: failed to fetch\`)`; otherwise wrap as
 * `error fetching`. Hand-rolled JSON helpers (e.g. devto, npm) follow the
 * same pattern. See `Adapter.fetch` in `types.ts` for throw vs warn+[] contract.
 */
import { errorMessage } from "./types";

const PACE_USER_AGENT = "pace/1.0";
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

type FetchWithTimeoutOptions = {
  timeoutMs?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  accept?: string;
};

/**
 * HTTP fetch with default User-Agent and AbortSignal.timeout.
 * Does not check res.ok — callers handle status or use fetchText.
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const headers: Record<string, string> = {
    "User-Agent": options.userAgent ?? PACE_USER_AGENT,
    ...options.headers,
  };
  if (options.accept) {
    headers.Accept = options.accept;
  }
  return fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Fetch URL as text; applies the module error-prefix conventions above. */
export async function fetchText(
  prefix: string,
  url: string,
  context: string = url,
  options: FetchWithTimeoutOptions = {},
): Promise<string> {
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

  try {
    return await res.text();
  } catch (err) {
    throw new Error(`${prefix}: error reading ${context}: ${errorMessage(err)}`);
  }
}