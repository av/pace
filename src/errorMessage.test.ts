import { test, expect, describe } from "bun:test";
import { errorMessage, parsePort, isValidPort, getAdapterName } from "./adapters/types";

describe("errorMessage (shared DRY helper for runtime/CLI)", () => {
  test("returns .message for Error and Error subclasses", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(new TypeError("type fail"))).toBe("type fail");
    expect(errorMessage(new RangeError("range"))).toBe("range");
  });

  test("returns String(value) for non-Error primitives (string, number, boolean)", () => {
    expect(errorMessage("plain msg")).toBe("plain msg");
    expect(errorMessage(123)).toBe("123");
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
});

describe("parsePort / isValidPort (shared port helpers DRYed across cli+index)", () => {
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

  test("parsePort falls back to default 3000 (or provided) for undefined, non-numeric, out-of-range", () => {
    expect(parsePort(undefined)).toBe(3000);
    expect(parsePort("")).toBe(3000);
    expect(parsePort("abc")).toBe(3000);
    expect(parsePort("99999")).toBe(3000);
    expect(parsePort("0")).toBe(3000);
    expect(parsePort("-10")).toBe(3000);
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
    expect(parsePort("65535", 3000)).toBe(65535);
  });
});

describe("getAdapterName (shared adapter config name fallback DRYed from index/scheduler/config)", () => {
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
