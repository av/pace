import { test, expect, describe } from "bun:test";
import {
  errorMessage,
  parsePort,
  parseCliPort,
  isValidPort,
  getAdapterName,
  sliceToLimit,
  compareIsoTimestamp,
  normalizeStringList,
  normalizeParamStringList,
  normalizeParamString,
  normalizeParamStringFirst,
  normalizeParamBoolean,
  normalizeOptionalString,
  canonicalOptionTypes,
  createAliasedResolver,
  resolveAliasedOption,
  simpleHash,
} from "./utils";

describe("errorMessage", () => {
  test("returns .message for Error and Error subclasses", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(new TypeError("type fail"))).toBe("type fail");
    expect(errorMessage(new RangeError("range"))).toBe("range");
  });

  test("returns String(value) for non-Error primitives (string, number, boolean)", () => {
    expect(errorMessage("plain msg")).toBe("plain msg");
    expect(errorMessage(123)).toBe("123");
    expect(errorMessage(404)).toBe("404");
    expect(errorMessage(0)).toBe("0");
    expect(errorMessage(true)).toBe("true");
    expect(errorMessage(false)).toBe("false");
  });

  test("handles null and undefined by String coercion", () => {
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  test("stringifies objects and other values without special .message", () => {
    expect(errorMessage({ code: 42, msg: "obj" })).toBe("[object Object]");
    const withToString = { toString: () => "custom-err" };
    expect(errorMessage(withToString)).toBe("custom-err");
    expect(errorMessage([1, 2, 3])).toBe("1,2,3");
  });

  test("does not include stack or cause details — only top-level message", () => {
    const err = new Error("top level only");
    err.cause = new Error("inner cause");
    expect(errorMessage(err)).toBe("top level only");
  });

  test("matches the inline patterns previously duplicated in scheduler/cli", () => {
    // simulates the exact ternary and String((err as Error|undef)?.message ?? err) behaviors
    const e = new Error("sim");
    expect(errorMessage(e)).toBe("sim");
    expect(errorMessage("str")).toBe("str");
  });

  test("returns .message for plain objects with .message prop (duck type, aids adapters catching custom error objs from fetch libs in network/parse paths)", () => {
    expect(errorMessage({ message: "network timeout" })).toBe("network timeout");
    expect(errorMessage({ message: "parse failed", code: "EBADXML" })).toBe("parse failed");
  });

  test("ignores non-string .message on duck-typed objects (hasStringMessage guard)", () => {
    expect(errorMessage({ message: 42 })).toBe("[object Object]");
    expect(errorMessage({ message: null })).toBe("[object Object]");
    expect(errorMessage({ message: undefined })).toBe("[object Object]");
    expect(errorMessage({ message: true })).toBe("[object Object]");
  });
});

describe("parseCliPort", () => {
  test("accepts full-string integers in range and rejects parseInt-style prefixes", () => {
    expect(parseCliPort("8080")).toBe(8080);
    expect(parseCliPort(" 3000 ")).toBe(3000);
    expect(parseCliPort("65535")).toBe(65535);
    expect(parseCliPort("8080abc")).toBeNull();
    expect(parseCliPort("65536")).toBeNull();
    expect(parseCliPort("0")).toBeNull();
    expect(parseCliPort("")).toBeNull();
    expect(parseCliPort("12.5")).toBeNull();
  });
});

describe("parsePort / isValidPort", () => {
  test("isValidPort accepts 1, 80, 3000, 65535 and rejects NaN, 0, negatives, 65536+", () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(80)).toBe(true);
    expect(isValidPort(3000)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(NaN)).toBe(false);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(99999)).toBe(false);
  });

  test("parsePort falls back to default 7453 (or provided) for undefined, non-numeric, out-of-range", () => {
    expect(parsePort(undefined)).toBe(7453);
    expect(parsePort("")).toBe(7453);
    expect(parsePort("8080abc")).toBe(7453);
    expect(parsePort("abc")).toBe(7453);
    expect(parsePort("99999")).toBe(7453);
    expect(parsePort("0")).toBe(7453);
    expect(parsePort("-10")).toBe(7453);
    expect(parsePort("65536", 4000)).toBe(4000);
    expect(parsePort("99999", 9999)).toBe(9999);
  });

  test("parsePort returns the input when valid (respects custom fallback only on invalid)", () => {
    expect(parsePort("80")).toBe(80);
    expect(parsePort("3000")).toBe(3000);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("1234", 9999)).toBe(1234); // valid ignores fallback
  });

  test("parsePort handles string from env/CLI and number-like edge cases", () => {
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535", 7453)).toBe(65535);
  });
});

describe("compareIsoTimestamp", () => {
  const older = "2024-01-01T00:00:00.000Z";
  const newer = "2024-06-15T12:00:00.000Z";

  test("desc (default): newer b sorts before older a (positive when b > a)", () => {
    expect(compareIsoTimestamp(older, newer)).toBe(1);
    expect(compareIsoTimestamp(older, newer, "desc")).toBe(1);
    expect(compareIsoTimestamp(newer, older)).toBe(-1);
    expect(compareIsoTimestamp(newer, older, "desc")).toBe(-1);
  });

  test("asc: older a sorts before newer b (negative when b > a)", () => {
    expect(compareIsoTimestamp(older, newer, "asc")).toBe(-1);
    expect(compareIsoTimestamp(newer, older, "asc")).toBe(1);
  });

  test("returns 0 for equal timestamps (stable sort preserves prior order)", () => {
    expect(compareIsoTimestamp(newer, newer)).toBe(0);
    expect(compareIsoTimestamp(newer, newer, "desc")).toBe(0);
    expect(compareIsoTimestamp(newer, newer, "asc")).toBe(0);
  });
});

describe("sliceToLimit", () => {
  test("returns at most limit items from the start", () => {
    expect(sliceToLimit([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(sliceToLimit([1, 2], 5)).toEqual([1, 2]);
    expect(sliceToLimit([], 3)).toEqual([]);
  });
});

describe("normalizeStringList", () => {
  test("trims entries and drops blank strings", () => {
    expect(normalizeStringList([" a ", "b", "  ", ""])).toEqual(["a", "b"]);
    expect(normalizeStringList([])).toEqual([]);
  });
});

describe("normalizeParamStringList", () => {
  test("reads and normalizes string-list adapter params", () => {
    expect(
      normalizeParamStringList({ tags: [" a ", "b"] }, "tags"),
    ).toEqual(["a", "b"]);
    expect(normalizeParamStringList({ tags: [" a ", "b"] }, "missing")).toEqual(
      [],
    );
    expect(normalizeParamStringList(undefined, "tags")).toEqual([]);
    expect(normalizeParamStringList({ tags: "a,b" }, "tags")).toEqual([]);
  });
});

describe("normalizeParamStringFirst", () => {
  test("uses first present key in order; blank present key does not fall through", () => {
    expect(
      normalizeParamStringFirst(
        { type: "best", feed: "new", stories: "ask" },
        ["type", "feed", "stories"],
        "top",
      ),
    ).toBe("best");
    expect(
      normalizeParamStringFirst({ feed: "new", stories: "ask" }, [
        "type",
        "feed",
        "stories",
      ]),
    ).toBe("new");
    expect(
      normalizeParamStringFirst({ type: "   ", feed: "new" }, [
        "type",
        "feed",
        "stories",
      ], "top"),
    ).toBe("top");
    expect(
      normalizeParamStringFirst({ type: "  new  " }, ["type", "feed"], "top"),
    ).toBe("new");
    expect(
      normalizeParamStringFirst({ type: 1, feed: "ask" }, [
        "type",
        "feed",
      ], "top"),
    ).toBe("top");
    expect(
      normalizeParamStringFirst(undefined, ["type", "feed"], "top"),
    ).toBe("top");
  });
});

describe("normalizeParamBoolean", () => {
  test("returns boolean values and fallback for missing or non-boolean params", () => {
    expect(normalizeParamBoolean({ enrich: true }, "enrich")).toBe(true);
    expect(normalizeParamBoolean({ enrich: false }, "enrich")).toBe(false);
    expect(normalizeParamBoolean({ enrich: "true" }, "enrich")).toBe(false);
    expect(normalizeParamBoolean({ enrich: 1 }, "enrich")).toBe(false);
    expect(normalizeParamBoolean({}, "enrich")).toBe(false);
    expect(normalizeParamBoolean(undefined, "enrich")).toBe(false);
    expect(normalizeParamBoolean({ only_media: true }, "only_media", false)).toBe(
      true,
    );
    expect(
      normalizeParamBoolean({ only_media: false }, "only_media", true),
    ).toBe(false);
    expect(normalizeParamBoolean({}, "only_media", true)).toBe(true);
  });
});

describe("normalizeParamString", () => {
  test("trims string params and returns fallback for missing, non-string, or blank", () => {
    expect(normalizeParamString({ mode: "  releases  " }, "mode")).toBe(
      "releases",
    );
    expect(normalizeParamString({ mode: "  " }, "mode", "releases")).toBe(
      "releases",
    );
    expect(normalizeParamString({ mode: 1 }, "mode", "releases")).toBe(
      "releases",
    );
    expect(normalizeParamString(undefined, "mode", "releases")).toBe(
      "releases",
    );
    expect(normalizeParamString({ mode: "" }, "mode")).toBeUndefined();
  });
});

describe("normalizeOptionalString", () => {
  test("trims and returns undefined for missing or blank values", () => {
    expect(normalizeOptionalString(undefined)).toBeUndefined();
    expect(normalizeOptionalString("")).toBeUndefined();
    expect(normalizeOptionalString("   ")).toBeUndefined();
  });

  test("returns trimmed non-blank string", () => {
    expect(normalizeOptionalString("  quantum  ")).toBe("quantum");
    expect(normalizeOptionalString("types")).toBe("types");
  });
});

describe("canonicalOptionTypes", () => {
  test("builds lowercase-keyed identity map from canonical tokens", () => {
    expect(canonicalOptionTypes("hot", "new", "top")).toEqual({
      hot: "hot",
      new: "new",
      top: "top",
    });
  });
});

describe("createAliasedResolver", () => {
  const resolveSort = createAliasedResolver({
    types: ["hot", "new"],
    aliases: { popular: "hot" },
    fallback: "new",
  });

  test("resolves canonical names and aliases via factory", () => {
    expect(resolveSort("Hot")).toBe("hot");
    expect(resolveSort("popular")).toBe("hot");
    expect(resolveSort("missing")).toBe("new");
  });

  test("supports labeled type maps and null fallback", () => {
    const resolveMode = createAliasedResolver({
      types: { hot: "Hot", new: "New" },
      aliases: { recent: "New" },
      fallback: null,
    });
    expect(resolveMode("hot")).toBe("Hot");
    expect(resolveMode("recent")).toBe("New");
    expect(resolveMode("missing")).toBeNull();
  });
});

describe("resolveAliasedOption", () => {
  const types = { hot: "hot", new: "new" } as const;
  const aliases = { popular: "hot", recent: "new" } as const;

  test("resolves canonical names case-insensitively", () => {
    expect(resolveAliasedOption("Hot", types, aliases, "new")).toBe("hot");
    expect(resolveAliasedOption("NEW", types, aliases, "hot")).toBe("new");
  });

  test("resolves aliases and falls back when unknown", () => {
    expect(resolveAliasedOption("popular", types, aliases, "new")).toBe("hot");
    expect(resolveAliasedOption("missing", types, aliases, "new")).toBe("new");
  });

  test("returns null fallback for unknown tokens", () => {
    expect(resolveAliasedOption("missing", types, aliases, null)).toBeNull();
    expect(resolveAliasedOption("hot", types, aliases, null)).toBe("hot");
  });
});

describe("simpleHash", () => {
  test("returns stable base36 hashes for the same input", () => {
    expect(simpleHash("")).toBe("0");
    expect(simpleHash("hello")).toBe(simpleHash("hello"));
    expect(simpleHash("First item body text")).toBe("1pmrwku");
  });

  test("differs for different inputs", () => {
    expect(simpleHash("a")).not.toBe(simpleHash("b"));
  });
});

describe("getAdapterName", () => {
  test("returns explicit name when present (prefers alias over type)", () => {
    expect(getAdapterName({ name: "myhn", type: "hackernews" })).toBe("myhn");
    expect(getAdapterName({ name: "devto-favs", type: "devto" })).toBe("devto-favs");
  });

  test("falls back to type when name omitted or undefined (?? semantics)", () => {
    expect(getAdapterName({ type: "rss" })).toBe("rss");
    expect(getAdapterName({ name: undefined, type: "podcast" })).toBe("podcast");
  });

  test("matches the inline `name ?? type` patterns previously duplicated in config/scheduler/index", () => {
    expect(getAdapterName({ name: "alias", type: "type" })).toBe("alias");
    expect(getAdapterName({ type: "type" })).toBe("type");
  });
});
