import { describe, expect, spyOn, test } from "bun:test";
import { normalizeHostname, safeLinkUrl, tryParseUrl } from "./utils";

describe("URL parse helpers", () => {
  describe("tryParseUrl", () => {
    test("returns null for empty input without warning", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(tryParseUrl("", "ctx", "label")).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("returns URL for valid http(s) input", () => {
      const parsed = tryParseUrl("https://Example.com/path", "ctx", "label");
      expect(parsed?.hostname).toBe("example.com");
    });

    test("warns and returns null on parse failure", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(tryParseUrl("not a url", "test", "parsing")).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^test: cannot parse URL "not a url" for parsing: /),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("normalizeHostname", () => {
    test("lowercases and strips www prefix", () => {
      expect(normalizeHostname("WWW.Example.COM")).toBe("example.com");
      expect(normalizeHostname("example.com")).toBe("example.com");
    });
  });

  describe("safeLinkUrl", () => {
    test("returns null for empty input without warning", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(safeLinkUrl("")).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("allows http, https, and mailto", () => {
      expect(safeLinkUrl("https://a.com")).toBe("https://a.com");
      expect(safeLinkUrl("http://a.com")).toBe("http://a.com");
      expect(safeLinkUrl("mailto:x@y.com")).toBe("mailto:x@y.com");
    });

    test("rejects disallowed protocols without warning", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(safeLinkUrl("ftp://files.example")).toBeNull();
        expect(safeLinkUrl("javascript:alert(1)")).toBeNull();
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("warns on parse failure like layout safeUrl", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(safeLinkUrl("not-a-url", "layout")).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(/^layout: cannot parse URL "not-a-url" for dashboard link: /),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});