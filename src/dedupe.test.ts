import { describe, test, expect } from "bun:test";
import { spyConsole } from "./test/console-spy";
import {
  dedupeByKey,
  dedupeByTitleSimilarity,
  dedupeGroupedByKey,
  normalizeUrl,
  extractHostname,
  jaccardSimilarity,
  levenshteinDistance,
  levenshteinSimilarity,
  pickWinner,
  titleSimilarity,
  unionFind,
} from "./dedupe";
import { makeContentItemRow as makeRow } from "./test/content-items";

describe("dedupe utils", () => {
  describe("dedupeByKey", () => {
    test("keeps first occurrence per key", () => {
      const items = [
        { id: "a", n: 1 },
        { id: "b", n: 2 },
        { id: "a", n: 3 },
      ];
      expect(dedupeByKey(items, (x) => x.id)).toEqual([
        { id: "a", n: 1 },
        { id: "b", n: 2 },
      ]);
    });

    test("returns empty array for empty input", () => {
      expect(dedupeByKey([], (x: { id: string }) => x.id)).toEqual([]);
    });
  });

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

    test("warns with errorMessage on parse failure", async () => {
      await spyConsole(["warn"], ({ warn: warnSpy }) => {
        const bad = "not a valid url at all";
        expect(normalizeUrl(bad)).toBe(bad);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^dedupe: normalizeUrl failed for "not a valid url at all": /),
        );
      });
    });
  });

  describe("extractHostname", () => {
    test("returns empty string for falsy input without warning", async () => {
      await spyConsole(["warn"], ({ warn: warnSpy }) => {
        expect(extractHostname("")).toBe("");
        expect(warnSpy).not.toHaveBeenCalled();
      });
    });

    test("returns lowercased host without www", () => {
      expect(extractHostname("https://WWW.Example.com/path")).toBe("example.com");
    });

    test("returns empty hostname for mailto links", () => {
      expect(extractHostname("mailto:user@example.com")).toBe("");
    });

    test("returns empty string and warns on parse failure", async () => {
      await spyConsole(["warn"], ({ warn: warnSpy }) => {
        expect(extractHostname("not a url", "test")).toBe("");
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^test: extractHostname failed for "not a url": /),
        );
      });
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

  describe("jaccardSimilarity", () => {
    test("returns 0 when either set is empty", () => {
      expect(jaccardSimilarity(new Set(), new Set(["a"]))).toBe(0);
      expect(jaccardSimilarity(new Set(["a"]), new Set())).toBe(0);
    });

    test("returns 1 for identical non-empty sets", () => {
      expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    });

    test("returns intersection over union for partial overlap", () => {
      expect(jaccardSimilarity(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3, 10);
    });
  });

  describe("titleSimilarity", () => {
    test("returns null when either title is blank after trim", () => {
      expect(titleSimilarity("", "hello")).toBeNull();
      expect(titleSimilarity("hello", "")).toBeNull();
      expect(titleSimilarity("  ", "hello")).toBeNull();
      expect(titleSimilarity(null, "hello")).toBeNull();
    });

    test("computes levenshtein similarity on lowercased trimmed titles", () => {
      expect(titleSimilarity("Hello World", "hello world")).toBe(1);
      const sim = titleSimilarity("Hello World Update", "Hello World Upd8");
      expect(sim).not.toBeNull();
      expect(sim!).toBeGreaterThan(0.5);
    });
  });

  describe("pickWinner", () => {
    test("keep:first returns first item in group", () => {
      const a = makeRow({ id: "a", timestamp: "2024-01-02T00:00:00Z" });
      const b = makeRow({ id: "b", timestamp: "2024-01-01T00:00:00Z" });
      expect(pickWinner([a, b], "first")).toBe(a);
    });

    test("keep:earliest picks lowest timestamp", () => {
      const early = makeRow({ id: "early", timestamp: "2024-01-01T00:00:00Z" });
      const late = makeRow({ id: "late", timestamp: "2024-01-02T00:00:00Z" });
      expect(pickWinner([late, early], "earliest")).toBe(early);
    });

    test("keep:highest-score picks highest extractScore body", () => {
      const low = makeRow({ id: "low", body: "no score", timestamp: "2024-01-01T00:00:00Z" });
      const high = makeRow({ id: "high", body: "upvotes: 42 score: 100", timestamp: "2024-01-02T00:00:00Z" });
      expect(pickWinner([low, high], "highest-score")).toBe(high);
    });
  });

  describe("dedupeGroupedByKey", () => {
    test("groups by key, keeps winner, preserves input order", () => {
      const items = [
        makeRow({ id: "1", url: "https://ex.com/a", title: "A1" }),
        makeRow({ id: "2", url: "https://ex.com/a", title: "A2" }),
        makeRow({ id: "3", url: "https://ex.com/b", title: "B" }),
      ];
      const { result, removed } = dedupeGroupedByKey(
        items,
        (item) => item.url!,
        "first",
        (loser) => loser.title,
      );
      expect(result.map((r) => r.id)).toEqual(["1", "3"]);
      expect(removed).toEqual(["A2"]);
    });
  });

  describe("dedupeByTitleSimilarity", () => {
    test("does not collapse items with blank titles", () => {
      const items = [
        makeRow({ id: "blank1", title: "", url: "https://ex.com/blank1" }),
        makeRow({ id: "blank2", title: "", url: "https://ex.com/blank2" }),
        makeRow({ id: "normal", title: "Real News Item", url: "https://ex.com/real" }),
      ];
      const { result } = dedupeByTitleSimilarity(
        items,
        0.5,
        "earliest",
        (loser) => loser.id,
      );
      expect(result).toHaveLength(3);
    });
  });

  describe("unionFind", () => {
    test("merges components and finds representatives with path compression", () => {
      const { find, union } = unionFind(4);
      union(0, 1);
      union(2, 3);
      union(1, 2);
      const root = find(0);
      expect(find(1)).toBe(root);
      expect(find(2)).toBe(root);
      expect(find(3)).toBe(root);
    });
  });
});
