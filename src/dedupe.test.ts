import { describe, test, expect, spyOn } from "bun:test";
import { normalizeUrl, extractHostname, levenshteinDistance, levenshteinSimilarity } from "./dedupe";

describe("dedupe utils", () => {
  describe("normalizeUrl", () => {
    test("returns empty string for falsy/empty input", () => {
      expect(normalizeUrl("")).toBe("");
      expect(normalizeUrl(null as unknown as string)).toBe("");
      expect(normalizeUrl(undefined as unknown as string)).toBe("");
    });

    test("strips common tracking/analytics params (utm_*, fbclid, gclid, ref, source, etc) while preserving others", () => {
      const input = "https://example.com/path?keep=1&utm_source=foo&fbclid=bar&ref=baz&other=2";
      expect(normalizeUrl(input)).toBe("https://example.com/path?keep=1&other=2");
    });

    test("lowercases host, strips www. prefix, removes fragment, strips trailing slash unless root", () => {
      expect(normalizeUrl("https://WWW.Example.com/path/?q=1#frag")).toBe("https://example.com/path?q=1");
      expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
      expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
      expect(normalizeUrl("https://example.com/path/?")).toBe("https://example.com/path");
    });

    test("falls back to lowercased+trimmed original on parse failure (invalid URL)", () => {
      expect(normalizeUrl("not a valid url at all")).toBe("not a valid url at all");
      expect(normalizeUrl("HTTP://Bad Host With Spaces")).toBe("http://bad host with spaces");
    });

    test("warns with errorMessage on parse failure", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const bad = "not a valid url at all";
        expect(normalizeUrl(bad)).toBe(bad);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^dedupe: normalizeUrl failed for "not a valid url at all": /),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("extractHostname", () => {
    test("returns lowercased host without www", () => {
      expect(extractHostname("https://WWW.Example.com/path")).toBe("example.com");
    });

    test("returns empty string and warns on parse failure", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(extractHostname("not a url", "test")).toBe("");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^test: extractHostname failed for "not a url": /),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("levenshteinDistance", () => {
    test("returns 0 for identical strings", () => {
      expect(levenshteinDistance("abc", "abc")).toBe(0);
      expect(levenshteinDistance("", "")).toBe(0);
    });

    test("returns length of other for empty string", () => {
      expect(levenshteinDistance("", "abc")).toBe(3);
      expect(levenshteinDistance("abc", "")).toBe(3);
    });

    test("computes classic edit distance (kitten/sitting = 3)", () => {
      expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    });

    test("handles swapped length (shorter first internally)", () => {
      expect(levenshteinDistance("sitting", "kitten")).toBe(3);
      expect(levenshteinDistance("abc", "ab")).toBe(1);
    });
  });

  describe("levenshteinSimilarity", () => {
    test("returns 1.0 for identical strings", () => {
      expect(levenshteinSimilarity("foo", "foo")).toBe(1);
      expect(levenshteinSimilarity("", "")).toBe(1);
    });

    test("returns 0 for completely different single char", () => {
      expect(levenshteinSimilarity("a", "b")).toBe(0);
    });

    test("returns value in (0,1) for partial matches and scales by maxLen", () => {
      const sim = levenshteinSimilarity("kitten", "sitting");
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(1);
      expect(levenshteinSimilarity("abc", "abd")).toBeCloseTo(2 / 3, 10);
    });
  });
});
