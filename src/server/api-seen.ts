import type { Context } from "hono";
import { getSeenKeys, setItemsSeen } from "../db";
import { resolveCrossSiteRefreshRejection } from "./routes";

/**
 * Upper bound for one seen key. Keys are dedup identities (a normalized item
 * URL, or an item id when the URL is empty), so anything longer than this is
 * garbage — and an unbounded key would let any local page grow the seen table
 * without limit.
 */
export const MAX_SEEN_KEY_LENGTH = 2048;

/**
 * Upper bound for one bulk request's key count. The dashboard sends at most
 * one panel's worth of items (bounded by the panel limit of 500), so anything
 * larger is garbage — and an unbounded batch would let any local page grow
 * the seen table without limit in a single POST.
 */
export const MAX_SEEN_KEYS = 500;

export type ParsedSeenBody = { ok: true; keys: string[]; seen: boolean } | { ok: false; error: string };

/** Validate one seen key: non-empty string within the length cap. */
function seenKeyError(key: unknown, name: string): string | null {
  if (typeof key !== "string" || key.length === 0) {
    return `${name} must be a non-empty string`;
  }
  if (key.length > MAX_SEEN_KEY_LENGTH) {
    return `${name} must be at most ${MAX_SEEN_KEY_LENGTH} characters`;
  }
  return null;
}

/**
 * Validate a POST /api/seen JSON body: `{ key: string, seen: boolean }` for a
 * single mark, or `{ keys: string[], seen: boolean }` for a bulk update (mark
 * a whole panel read). The body is client input, so shape, type, length, and
 * batch size are all checked. A valid single key normalizes to a one-entry
 * `keys` list so the handler has exactly one path.
 */
export function parseSeenBody(body: unknown): ParsedSeenBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object: { key, seen } or { keys, seen }" };
  }
  const { key, keys, seen } = body as { key?: unknown; keys?: unknown; seen?: unknown };
  if (typeof seen !== "boolean") {
    return { ok: false, error: "seen must be a boolean" };
  }
  if (key !== undefined && keys !== undefined) {
    return { ok: false, error: "pass either key or keys, not both" };
  }
  if (keys !== undefined) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return { ok: false, error: "keys must be a non-empty array of strings" };
    }
    if (keys.length > MAX_SEEN_KEYS) {
      return { ok: false, error: `keys must contain at most ${MAX_SEEN_KEYS} entries` };
    }
    for (const entry of keys) {
      const error = seenKeyError(entry, "every keys entry");
      if (error) return { ok: false, error };
    }
    return { ok: true, keys: [...new Set(keys as string[])], seen };
  }
  const error = seenKeyError(key, "key");
  if (error) return { ok: false, error };
  return { ok: true, keys: [key as string], seen };
}

/**
 * GET /api/seen — every stored seen key, oldest mark first. The dashboard
 * client fetches this once on load and dims the matching items.
 */
export function handleApiSeenList(c: Context): Response {
  const keys = getSeenKeys();
  return c.json({ count: keys.length, keys });
}

/**
 * POST /api/seen with `{ key, seen }` or `{ keys, seen }` — persist or clear
 * one or many seen marks (bulk writes are atomic). State-changing, so it
 * carries the same cross-site guard as the refresh endpoint: same-origin
 * browsers and header-less non-browser clients pass, cross-origin pages are
 * rejected.
 */
export async function handleApiSeenSet(c: Context): Promise<Response> {
  const rejection = resolveCrossSiteRefreshRejection(c.req.raw.headers);
  if (rejection) return c.json({ error: `Forbidden: ${rejection}` }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON: { key, seen } or { keys, seen }" }, 400);
  }
  const parsed = parseSeenBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  setItemsSeen(parsed.keys, parsed.seen);
  return c.json({ count: parsed.keys.length, keys: parsed.keys, seen: parsed.seen });
}
