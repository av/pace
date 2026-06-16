import { describe, test, expect } from "bun:test";
import { describeValue } from "./validate-primitives";

describe("describeValue", () => {
  test("returns 'null' for null", () => {
    expect(describeValue(null)).toBe("null");
  });

  test("returns 'undefined' for undefined", () => {
    expect(describeValue(undefined)).toBe("undefined");
  });

  test("returns 'array' for arrays (including empty)", () => {
    expect(describeValue([])).toBe("array");
    expect(describeValue([1, 2, 3])).toBe("array");
    expect(describeValue(["a"])).toBe("array");
  });

  test("returns 'object' for plain objects", () => {
    expect(describeValue({})).toBe("object");
    expect(describeValue({ key: "value" })).toBe("object");
  });

  test('returns empty string "" for empty strings', () => {
    expect(describeValue("")).toBe('empty string ""');
  });

  test("returns quoted value for non-empty strings", () => {
    expect(describeValue("hello")).toBe('"hello"');
    expect(describeValue("hackernews")).toBe('"hackernews"');
    expect(describeValue("   ")).toBe('"   "');
  });

  test("returns stringified value for numbers", () => {
    expect(describeValue(42)).toBe("42");
    expect(describeValue(0)).toBe("0");
    expect(describeValue(-1)).toBe("-1");
    expect(describeValue(3.14)).toBe("3.14");
    expect(describeValue(NaN)).toBe("NaN");
    expect(describeValue(Infinity)).toBe("Infinity");
    expect(describeValue(-Infinity)).toBe("-Infinity");
  });

  test("returns stringified value for booleans", () => {
    expect(describeValue(true)).toBe("true");
    expect(describeValue(false)).toBe("false");
  });
});