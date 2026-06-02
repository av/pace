import { describe, test, expect } from "bun:test";
import { extractAtomLink } from "./adapters/atom";

describe("extractAtomLink", () => {
  test("returns empty string when link is missing", () => {
    expect(extractAtomLink(undefined)).toBe("");
  });

  test("returns RSS string links as-is", () => {
    expect(extractAtomLink("https://example.com/item")).toBe(
      "https://example.com/item",
    );
  });

  test("reads href from a single Atom link object", () => {
    expect(extractAtomLink({ "@_href": "https://a.example/x" })).toBe(
      "https://a.example/x",
    );
  });

  test("prefers rel=alternate in link arrays", () => {
    const link = [
      { "@_href": "https://example.com/self", "@_rel": "self" },
      { "@_href": "https://example.com/page", "@_rel": "alternate" },
    ];
    expect(extractAtomLink(link)).toBe("https://example.com/page");
  });

  test("falls back to first href when no alternate rel", () => {
    const link = [
      { "@_href": "https://example.com/first", "@_rel": "self" },
      { "@_href": "https://example.com/second", "@_rel": "enclosure" },
    ];
    expect(extractAtomLink(link)).toBe("https://example.com/first");
  });
});