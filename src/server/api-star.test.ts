import { describe, test, expect } from "bun:test";
import {
  getDb,
  getStarredKeys,
  initDb,
  pruneOldItems,
  setItemStarred,
} from "../db";
import { MAX_SEEN_KEY_LENGTH } from "./api-seen";
import { parseStarBody } from "./api-star";
import { installTempDbHooks } from "../test/temp-db";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import {
  createTestServerApp,
  expectSecurityHeaders,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

installTempDbHooks({ prefix: "pace-api-star-" });

function makeApp(basePath = "") {
  const layout = flexCfg("row", [panelCfg("Tech", "hackernews", { id: "tech-panel" })]);
  return createTestServerApp(makeServerRouteDeps({ layout, basePath }));
}

function postStar(
  app: ReturnType<typeof makeApp>,
  body: string,
  headers: Record<string, string> = {},
  path = "/api/star",
) {
  return requestServerRoute(app, path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

/* ------------------------------------------------------------------ */
/* db: setItemStarred / getStarredKeys                                 */
/* ------------------------------------------------------------------ */

describe("setItemStarred / getStarredKeys", () => {
  test("marks persist, are idempotent, and clear again", () => {
    initDb();
    setItemStarred("https://ex.com/a", true);
    setItemStarred("https://ex.com/a", true);
    setItemStarred("https://ex.com/b", true);
    expect(getStarredKeys().sort()).toEqual(["https://ex.com/a", "https://ex.com/b"]);

    setItemStarred("https://ex.com/a", false);
    expect(getStarredKeys()).toEqual(["https://ex.com/b"]);
    // Clearing an absent key is a no-op, not an error.
    setItemStarred("https://ex.com/never", false);
    expect(getStarredKeys()).toEqual(["https://ex.com/b"]);
  });

  test("empty database yields no keys", () => {
    initDb();
    expect(getStarredKeys()).toEqual([]);
  });

  test("stars survive retention pruning even when old and orphaned", () => {
    initDb();
    const db = getDb();
    setItemStarred("https://ex.com/kept", true);
    // Age the mark far past any retention window; stars are deliberate
    // keep-marks, so unlike seen marks they must survive pruning.
    db.prepare(
      "UPDATE starred_items SET starred_at = datetime('now', '-900 days') WHERE star_key = ?",
    ).run("https://ex.com/kept");

    pruneOldItems(30);
    expect(getStarredKeys()).toEqual(["https://ex.com/kept"]);
  });
});

/* ------------------------------------------------------------------ */
/* parseStarBody                                                       */
/* ------------------------------------------------------------------ */

describe("parseStarBody", () => {
  test("accepts { key, starred }", () => {
    expect(parseStarBody({ key: "https://ex.com/a", starred: true })).toEqual({
      ok: true,
      key: "https://ex.com/a",
      starred: true,
    });
    expect(parseStarBody({ key: "k", starred: false })).toEqual({
      ok: true,
      key: "k",
      starred: false,
    });
  });

  test("rejects non-objects, missing/invalid keys, and non-boolean starred", () => {
    for (const body of [
      null,
      "x",
      42,
      ["k"],
      {},
      { key: "", starred: true },
      { key: 7, starred: true },
      { key: "k" },
      { key: "k", starred: "yes" },
    ]) {
      expect(parseStarBody(body).ok).toBe(false);
    }
  });

  test("rejects keys beyond the shared seen-key length cap", () => {
    expect(parseStarBody({ key: "x".repeat(MAX_SEEN_KEY_LENGTH + 1), starred: true }).ok).toBe(
      false,
    );
    expect(parseStarBody({ key: "x".repeat(MAX_SEEN_KEY_LENGTH), starred: true }).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* HTTP surface                                                        */
/* ------------------------------------------------------------------ */

describe("GET /api/star", () => {
  test("returns the stored keys with security headers", async () => {
    initDb();
    setItemStarred("https://ex.com/a", true);
    const app = makeApp();
    const res = await requestServerRoute(app, "/api/star");
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
    expect(await res.json()).toEqual({ count: 1, keys: ["https://ex.com/a"] });
  });

  test("empty state returns count 0", async () => {
    const res = await requestServerRoute(makeApp(), "/api/star");
    expect(await res.json()).toEqual({ count: 0, keys: [] });
  });

  test("is served under a configured base path", async () => {
    const res = await requestServerRoute(makeApp("/pace"), "/pace/api/star");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/star", () => {
  test("persists a mark and clears it again", async () => {
    const app = makeApp();
    const set = await postStar(app, JSON.stringify({ key: "https://ex.com/a", starred: true }));
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ key: "https://ex.com/a", starred: true });
    expect(getStarredKeys()).toEqual(["https://ex.com/a"]);

    const clear = await postStar(app, JSON.stringify({ key: "https://ex.com/a", starred: false }));
    expect(clear.status).toBe(200);
    expect(getStarredKeys()).toEqual([]);
  });

  test("rejects malformed JSON and invalid bodies with 400", async () => {
    const app = makeApp();
    const bad = await postStar(app, "{not json");
    expect(bad.status).toBe(400);
    const invalid = await postStar(app, JSON.stringify({ key: "", starred: true }));
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toContain("key");
    expect(getStarredKeys()).toEqual([]);
  });

  test("rejects cross-site requests with 403 (same guard as refresh)", async () => {
    const app = makeApp();
    const res = await postStar(app, JSON.stringify({ key: "k", starred: true }), {
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect(getStarredKeys()).toEqual([]);
  });

  test("same-origin browser posts pass the guard", async () => {
    const app = makeApp();
    const res = await postStar(app, JSON.stringify({ key: "k", starred: true }), {
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(200);
    expect(getStarredKeys()).toEqual(["k"]);
  });

  test("works under a configured base path", async () => {
    const res = await postStar(
      makeApp("/pace"),
      JSON.stringify({ key: "k", starred: true }),
      {},
      "/pace/api/star",
    );
    expect(res.status).toBe(200);
  });
});
