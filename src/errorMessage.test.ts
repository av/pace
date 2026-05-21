import { test, expect, describe } from "bun:test";
import { errorMessage } from "./adapters/types";

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
