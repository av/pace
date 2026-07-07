import { describe, test, expect } from "bun:test";
import { makeContentItemRow } from "./test/content-items";
import {
  buildClusterSignals,
  computeClusterSimilarity,
  registrableDomain,
  type ClusterItemSignals,
} from "./cluster-signals";

function signal(overrides: Partial<ClusterItemSignals> = {}): ClusterItemSignals {
  return {
    domain: "",
    keywords: new Set(),
    source: "",
    ...overrides,
  };
}

describe("cluster-signals", () => {
  describe("buildClusterSignals", () => {
    test("extracts hostname domain and source from content rows", () => {
      const items = [
        makeContentItemRow({
          url: "https://github.com/org/repo",
          title: "Release notes",
          source: "github-releases",
          body: "",
        }),
      ];

      const [sig] = buildClusterSignals(items);

      expect(sig.domain).toBe("github.com");
      expect(sig.source).toBe("github-releases");
    });

    test("derives keywords from title and strips stop words and pure digits", () => {
      const items = [
        makeContentItemRow({
          title: "The React Server Components guide for 2024",
          body: "",
        }),
      ];

      const [sig] = buildClusterSignals(items);

      expect(sig.keywords.has("react")).toBe(true);
      expect(sig.keywords.has("server")).toBe(true);
      expect(sig.keywords.has("components")).toBe(true);
      expect(sig.keywords.has("guide")).toBe(true);
      expect(sig.keywords.has("the")).toBe(false);
      expect(sig.keywords.has("for")).toBe(false);
      expect(sig.keywords.has("2024")).toBe(false);
    });

    test("strips engagement metrics and urls from body before keyword extraction", () => {
      const items = [
        makeContentItemRow({
          title: "Alpha topic",
          body: "42 points | https://news.ycombinator.com/item?id=1 | discuss: thread",
        }),
      ];

      const [sig] = buildClusterSignals(items);

      expect(sig.keywords.has("alpha")).toBe(true);
      expect(sig.keywords.has("topic")).toBe(true);
      expect(sig.keywords.has("points")).toBe(false);
      expect(sig.keywords.has("discuss")).toBe(false);
      expect(sig.keywords.has("https")).toBe(false);
    });
  });

  describe("computeClusterSimilarity", () => {
    test("domain strategy returns 1.0 for exact match and 0.7 for shared registrable domain", () => {
      const exact = signal({ domain: "github.com" });
      const sibling = signal({ domain: "api.github.com" });
      const unrelated = signal({ domain: "example.com" });

      expect(computeClusterSimilarity(exact, exact, "domain")).toBe(1);
      expect(computeClusterSimilarity(exact, sibling, "domain")).toBe(0.7);
      expect(computeClusterSimilarity(exact, unrelated, "domain")).toBe(0);
    });

    test("domain strategy does not cluster unrelated sites under a shared ccTLD public suffix", () => {
      const bbc = signal({ domain: "bbc.co.uk" });
      const guardian = signal({ domain: "guardian.co.uk" });
      const bbcNews = signal({ domain: "news.bbc.co.uk" });
      const smh = signal({ domain: "smh.com.au" });
      const abcAu = signal({ domain: "abc.net.au" });

      // Different registrants under co.uk must NOT match (was 0.7 before fix)
      expect(computeClusterSimilarity(bbc, guardian, "domain")).toBe(0);
      // Same registrant under co.uk still matches at 0.7
      expect(computeClusterSimilarity(bbc, bbcNews, "domain")).toBe(0.7);
      // Different suffixes never match
      expect(computeClusterSimilarity(smh, abcAu, "domain")).toBe(0);
      // Exact match unaffected
      expect(computeClusterSimilarity(bbc, bbc, "domain")).toBe(1);
    });

    test("registrableDomain handles suffix shortlist and plain TLDs", () => {
      expect(registrableDomain("bbc.co.uk")).toBe("bbc.co.uk");
      expect(registrableDomain("news.bbc.co.uk")).toBe("bbc.co.uk");
      expect(registrableDomain("api.github.com")).toBe("github.com");
      expect(registrableDomain("github.com")).toBe("github.com");
      expect(registrableDomain("localhost")).toBe("localhost");
      expect(registrableDomain("a.b.smh.com.au")).toBe("smh.com.au");
      expect(registrableDomain("blog.example.co.jp")).toBe("example.co.jp");
      // "update.com" is not a public suffix even though "update" looks generic
      expect(registrableDomain("x.update.com")).toBe("update.com");
    });

    test("keywords strategy uses jaccard overlap", () => {
      const a = signal({ keywords: new Set(["react", "typescript", "vite"]) });
      const b = signal({ keywords: new Set(["react", "typescript", "webpack"]) });
      const c = signal({ keywords: new Set(["python", "django"]) });

      expect(computeClusterSimilarity(a, b, "keywords")).toBeCloseTo(2 / 4);
      expect(computeClusterSimilarity(a, c, "keywords")).toBe(0);
    });

    test("source strategy returns 1.0 only for matching non-empty sources", () => {
      const a = signal({ source: "hn" });
      const b = signal({ source: "hn" });
      const c = signal({ source: "rss" });
      const empty = signal({ source: "" });

      expect(computeClusterSimilarity(a, b, "source")).toBe(1);
      expect(computeClusterSimilarity(a, c, "source")).toBe(0);
      expect(computeClusterSimilarity(a, empty, "source")).toBe(0);
    });

    test("auto strategy blends domain, keywords, and source weights", () => {
      const a = signal({
        domain: "github.com",
        keywords: new Set(["react"]),
        source: "gh",
      });
      const b = signal({
        domain: "github.com",
        keywords: new Set(["react", "vue"]),
        source: "gh",
      });

      const sim = computeClusterSimilarity(a, b, "auto");

      expect(sim).toBeCloseTo(0.5 * 1 + 0.45 * (1 / 2) + 0.05 * 1);
    });
  });
});