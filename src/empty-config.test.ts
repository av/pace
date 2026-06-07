import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { warnEmptyConfig } from "./adapters/empty-config";

describe("warnEmptyConfig", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("warns with adapter prefix and returns empty array", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    expect(warnEmptyConfig("rss", "no urls configured")).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith("rss: no urls configured");
  });

  test("uses provided adapter name for parameterized adapters", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    warnEmptyConfig("github-releases", "no repos configured");
    expect(warnSpy).toHaveBeenCalledWith("github-releases: no repos configured");
  });
});