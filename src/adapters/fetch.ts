import { errorMessage } from "./types";

export const PACE_USER_AGENT = "pace/1.0";
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export type FetchWithTimeoutOptions = {
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

/**
 * Fetch URL as text with timeout, User-Agent, and adapter-prefixed errors.
 * Matches rss-style messages: error fetching / failed to fetch / error reading.
 */
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