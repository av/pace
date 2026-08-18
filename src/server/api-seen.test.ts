import { describe, test, expect } from "bun:test";
import {
  getDb,
  getSeenKeys,
  initDb,
  itemSeenKey,
  pruneOldItems,
  saveItems,
  setItemSeen,
  setItemsSeen,
} from "../db";
import { MAX_SEEN_KEY_LENGTH, MAX_SEEN_KEYS, parseSeenBody } from "./api-seen";
import { makeContentItem as makeItem } from "../test/content-items";
import { installTempDbHooks } from "../test/temp-db";
import { flexCfg, panelCfg } from "../test/layout-cfg";
import {
  createTestServerApp,
  expectSecurityHeaders,
  makeServerRouteDeps,
  requestServerRoute,
} from "../test/server-harness";

installTempDbHooks({ prefix: "pace-api-seen-" });

function makeApp(basePath = "") {
  const layout = flexCfg("row", [panelCfg("Tech", "hackernews", { id: "tech-panel" })]);
  return createTestServerApp(makeServerRouteDeps({ layout, basePath }));
}

function postSeen(
  app: ReturnType<typeof makeApp>,
  body: string,
  headers: Record<string, string> = {},
  path = "/api/seen",
) {
  return requestServerRoute(app, path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

/* ------------------------------------------------------------------ */
/* itemSeenKey                                                         */
/* ------------------------------------------------------------------ */

describe("itemSeenKey", () => {
  test("normalizes the url: ASCII lowercase, trailing slashes stripped", () => {
    expect(itemSeenKey({ id: "a", url: "https://Ex.com/Post/" })).toBe("https://ex.com/post");
    expect(itemSeenKey({ id: "a", url: "https://ex.com/p///" })).toBe("https://ex.com/p");
    expect(itemSeenKey({ id: "a", url: "https://ex.com/p" })).toBe("https://ex.com/p");
  });

  test("falls back to the item id when the url is empty", () => {
    expect(itemSeenKey({ id: "counter:x", url: "" })).toBe("counter:x");
  });

  test("matches the SQL dedup group expression exactly", () => {
    initDb();
    const db = getDb();
    const stmt = db.prepare(
      "SELECT CASE WHEN ? = '' THEN ? ELSE lower(rtrim(?, '/')) END AS k",
    );
    const samples = [
      { id: "i1", url: "https://Ex.com/A/B/" },
      { id: "i2", url: "" },
      { id: "i3", url: "HTTPS://EX.COM/Ünïcode/Path/" },
      { id: "i4", url: "https://ex.com/trailing////" },
    ];
    for (const item of samples) {
      const row = stmt.get(item.url, item.id, item.url) as { k: string };
      expect(itemSeenKey(item)).toBe(row.k);
    }
  });
});

/* ------------------------------------------------------------------ */
/* db: setItemSeen / getSeenKeys / retention                           */
/* ------------------------------------------------------------------ */

describe("setItemSeen / getSeenKeys", () => {
  test("marks persist, are idempotent, and clear again", () => {
    initDb();
    setItemSeen("https://ex.com/a", true);
    setItemSeen("https://ex.com/a", true);
    setItemSeen("https://ex.com/b", true);
    expect(getSeenKeys().sort()).toEqual(["https://ex.com/a", "https://ex.com/b"]);

    setItemSeen("https://ex.com/a", false);
    expect(getSeenKeys()).toEqual(["https://ex.com/b"]);
    // Clearing an absent key is a no-op, not an error.
    setItemSeen("https://ex.com/never", false);
    expect(getSeenKeys()).toEqual(["https://ex.com/b"]);
  });

  test("empty database yields no keys", () => {
    initDb();
    expect(getSeenKeys()).toEqual([]);
  });
});

describe("setItemsSeen", () => {
  test("marks and clears many keys at once, idempotently", () => {
    initDb();
    setItemsSeen(["a", "b", "c"], true);
    setItemsSeen(["b", "c"], true);
    expect(getSeenKeys().sort()).toEqual(["a", "b", "c"]);

    setItemsSeen(["a", "c", "never-marked"], false);
    expect(getSeenKeys()).toEqual(["b"]);
    setItemsSeen([], true); // empty batch is a no-op, not an error
    expect(getSeenKeys()).toEqual(["b"]);
  });
});

describe("seen retention (pruneOldItems)", () => {
  test("old orphaned marks are pruned; marks for live items and recent marks survive", () => {
    initDb();
    const db = getDb();
    saveItems("tech-panel", [makeItem({ id: "live", url: "https://ex.com/live" })]);

    setItemSeen("https://ex.com/live", true);
    setItemSeen("https://ex.com/gone-old", true);
    setItemSeen("https://ex.com/gone-recent", true);
    // Age two marks past the retention window; only the orphan may die.
    db.prepare(
      "UPDATE seen_items SET seen_at = datetime('now', '-90 days') WHERE seen_key IN (?, ?)",
    ).run("https://ex.com/live", "https://ex.com/gone-old");

    pruneOldItems(30);
    expect(getSeenKeys().sort()).toEqual([
      "https://ex.com/gone-recent",
      "https://ex.com/live",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* parseSeenBody                                                       */
/* ------------------------------------------------------------------ */

describe("parseSeenBody", () => {
  test("accepts { key, seen } and normalizes it to a one-entry keys list", () => {
    expect(parseSeenBody({ key: "https://ex.com/a", seen: true })).toEqual({
      ok: true,
      keys: ["https://ex.com/a"],
      seen: true,
    });
    expect(parseSeenBody({ key: "k", seen: false })).toEqual({ ok: true, keys: ["k"], seen: false });
  });

  test("accepts { keys, seen } and dedupes repeated entries", () => {
    expect(parseSeenBody({ keys: ["a", "b", "a"], seen: true })).toEqual({
      ok: true,
      keys: ["a", "b"],
      seen: true,
    });
  });

  test("rejects non-objects, missing/invalid keys, and non-boolean seen", () => {
    for (const body of [null, "x", 42, ["k"], {}, { key: "", seen: true }, { key: 7, seen: true }, { key: "k" }, { key: "k", seen: "yes" }]) {
      const parsed = parseSeenBody(body);
      expect(parsed.ok).toBe(false);
    }
  });

  test("rejects invalid bulk bodies: empty/non-array keys, bad entries, key+keys together", () => {
    for (const body of [
      { keys: [], seen: true },
      { keys: "a", seen: true },
      { keys: ["a", ""], seen: true },
      { keys: ["a", 7], seen: true },
      { keys: ["a", "x".repeat(MAX_SEEN_KEY_LENGTH + 1)], seen: true },
      { key: "a", keys: ["b"], seen: true },
      { keys: ["a"] },
    ]) {
      expect(parseSeenBody(body).ok).toBe(false);
    }
  });

  test("caps bulk batches at MAX_SEEN_KEYS entries", () => {
    const keys = Array.from({ length: MAX_SEEN_KEYS }, (_, i) => `k${i}`);
    expect(parseSeenBody({ keys, seen: true }).ok).toBe(true);
    expect(parseSeenBody({ keys: [...keys, "extra"], seen: true }).ok).toBe(false);
  });

  test("rejects keys beyond the length cap", () => {
    const parsed = parseSeenBody({ key: "x".repeat(MAX_SEEN_KEY_LENGTH + 1), seen: true });
    expect(parsed.ok).toBe(false);
    expect(parseSeenBody({ key: "x".repeat(MAX_SEEN_KEY_LENGTH), seen: true }).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* HTTP surface                                                        */
/* ------------------------------------------------------------------ */

describe("GET /api/seen", () => {
  test("returns the stored keys with security headers", async () => {
    initDb();
    setItemSeen("https://ex.com/a", true);
    const app = makeApp();
    const res = await requestServerRoute(app, "/api/seen");
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
    expect(await res.json()).toEqual({ count: 1, keys: ["https://ex.com/a"] });
  });

  test("empty state returns count 0", async () => {
    const res = await requestServerRoute(makeApp(), "/api/seen");
    expect(await res.json()).toEqual({ count: 0, keys: [] });
  });

  test("is served under a configured base path", async () => {
    const res = await requestServerRoute(makeApp("/pace"), "/pace/api/seen");
    expect(res.status).toBe(200);
  });
});

describe("POST /api/seen", () => {
  test("persists a mark and clears it again", async () => {
    const app = makeApp();
    const set = await postSeen(app, JSON.stringify({ key: "https://ex.com/a", seen: true }));
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ count: 1, keys: ["https://ex.com/a"], seen: true });
    expect(getSeenKeys()).toEqual(["https://ex.com/a"]);

    const clear = await postSeen(app, JSON.stringify({ key: "https://ex.com/a", seen: false }));
    expect(clear.status).toBe(200);
    expect(getSeenKeys()).toEqual([]);
  });

  test("bulk body persists all keys and clears them again", async () => {
    const app = makeApp();
    const set = await postSeen(app, JSON.stringify({ keys: ["a", "b", "a"], seen: true }));
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ count: 2, keys: ["a", "b"], seen: true });
    expect(getSeenKeys().sort()).toEqual(["a", "b"]);

    const clear = await postSeen(app, JSON.stringify({ keys: ["a", "b"], seen: false }));
    expect(clear.status).toBe(200);
    expect(getSeenKeys()).toEqual([]);
  });

  test("rejects invalid bulk bodies with 400", async () => {
    const app = makeApp();
    const res = await postSeen(app, JSON.stringify({ keys: [], seen: true }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("keys");
    expect(getSeenKeys()).toEqual([]);
  });

  test("rejects malformed JSON and invalid bodies with 400", async () => {
    const app = makeApp();
    const bad = await postSeen(app, "{not json");
    expect(bad.status).toBe(400);
    const invalid = await postSeen(app, JSON.stringify({ key: "", seen: true }));
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: string }).error).toContain("key");
    expect(getSeenKeys()).toEqual([]);
  });

  test("rejects cross-site requests with 403 (same guard as refresh)", async () => {
    const app = makeApp();
    const res = await postSeen(app, JSON.stringify({ key: "k", seen: true }), {
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect(getSeenKeys()).toEqual([]);
  });

  test("same-origin browser posts pass the guard", async () => {
    const app = makeApp();
    const res = await postSeen(app, JSON.stringify({ key: "k", seen: true }), {
      "sec-fetch-site": "same-origin",
    });
    expect(res.status).toBe(200);
    expect(getSeenKeys()).toEqual(["k"]);
  });

  test("works under a configured base path", async () => {
    const res = await postSeen(
      makeApp("/pace"),
      JSON.stringify({ key: "k", seen: true }),
      {},
      "/pace/api/seen",
    );
    expect(res.status).toBe(200);
  });
});
