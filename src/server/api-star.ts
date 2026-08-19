import type { Context } from "hono";
import { getStarredKeys, setItemStarred } from "../db";
import { MAX_SEEN_KEY_LENGTH } from "./api-seen";
import { resolveCrossSiteRefreshRejection } from "./routes";

export type ParsedStarBody = { ok: true; key: string; starred: boolean } | { ok: false; error: string };

/**
 * Validate a POST /api/star JSON body: `{ key: string, starred: boolean }`.
 * The body is client input, so shape, type, and length are all checked. Keys
 * are the same dedup identities the seen marks use, so they share the seen
 * length cap — anything longer is garbage, and an unbounded key would let any
 * local page grow the star table without limit.
 */
export function parseStarBody(body: unknown): ParsedStarBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object: { key, starred }" };
  }
  const { key, starred } = body as { key?: unknown; starred?: unknown };
  if (typeof starred !== "boolean") {
    return { ok: false, error: "starred must be a boolean" };
  }
  if (typeof key !== "string" || key.length === 0) {
    return { ok: false, error: "key must be a non-empty string" };
  }
  if (key.length > MAX_SEEN_KEY_LENGTH) {
    return { ok: false, error: `key must be at most ${MAX_SEEN_KEY_LENGTH} characters` };
  }
  return { ok: true, key, starred };
}

/**
 * GET /api/star — every stored star key, oldest mark first. The dashboard
 * client fetches this once on load and marks the matching items starred.
 */
export function handleApiStarList(c: Context): Response {
  const keys = getStarredKeys();
  return c.json({ count: keys.length, keys });
}

/**
 * POST /api/star with `{ key, starred }` — persist or clear one star mark.
 * State-changing, so it carries the same cross-site guard as the refresh and
 * seen endpoints: same-origin browsers and header-less non-browser clients
 * pass, cross-origin pages are rejected.
 */
export async function handleApiStarSet(c: Context): Promise<Response> {
  const rejection = resolveCrossSiteRefreshRejection(c.req.raw.headers);
  if (rejection) return c.json({ error: `Forbidden: ${rejection}` }, 403);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be valid JSON: { key, starred }" }, 400);
  }
  const parsed = parseStarBody(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  setItemStarred(parsed.key, parsed.starred);
  return c.json({ key: parsed.key, starred: parsed.starred });
}
