import type { Context } from "hono";
import { getSeenKeys, setItemSeen } from "../db";
import { resolveCrossSiteRefreshRejection } from "./routes";

/**
 * Upper bound for one seen key. Keys are dedup identities (a normalized item
 * URL, or an item id when the URL is empty), so anything longer than this is
 * garbage — and an unbounded key would let any local page grow the seen table
 * without limit.
 */
export const MAX_SEEN_KEY_LENGTH = 2048;

export type ParsedSeenBody = { ok: true; key: string; seen: boolean } | { ok: false; error: string };

/**
 * Validate a POST /api/seen JSON body: `{ key: string, seen: boolean }`.
 * The body is client input, so shape, type, and length are all checked.
 */
export function parseSeenBody(body: unknown): ParsedSeenBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object: { key, seen }" };
  }
  const { key, seen } = body as { key?: unknown; seen?: unknown };
  if (typeof key !== "string" || key.length === 0) {
    return { ok: false, error: "key must be a non-empty string" };
  }
  if (key.length > MAX_SEEN_KEY_LENGTH) {
    return { ok: false, error: `key must be at most ${MAX_SEEN_KEY_LENGTH} characters` };
  }
  if (typeof seen !== "boolean") {
    return { ok: false, error: "seen must be a boolean" };
  }
  return { ok: true, key, seen };
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
 * POST /api/seen with `{ key, seen }` — persist or clear one seen mark.
 * State-changing, so it carries the same cross-site guard as the refresh
 * endpoint: same-origin browsers and header-less non-browser clients pass,
 * cross-origin pages are rejected.
 */
export async function handleApiSeenSet(c: Context): Promise<Response> {
  const rejection = resolveCrossSiteRefreshRejection(c.req.raw.headers);
  if (rejection) return c.json({ error: `Forbidden: ${rejection}` }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON: { key, seen }" }, 400);
  }
  const parsed = parseSeenBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  setItemSeen(parsed.key, parsed.seen);
  return c.json({ key: parsed.key, seen: parsed.seen });
}
