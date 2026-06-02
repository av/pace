import { describe, it, expect, spyOn, mock } from "bun:test";
import podcastAdapter from "./podcast";
import * as typesMod from "./types";

describe("podcast adapter", () => {
  it("satisfies ngb contract: default export has .name and .fetch", () => {
    expect(podcastAdapter.name).toBe("podcast");
    expect(typeof podcastAdapter.fetch).toBe("function");
  });

  it("uses errorMessage helper in fetch !ok error path per mmu/sh1 (delta + call shape)", async () => {
    const errorMessageSpy = spyOn(typesMod, "errorMessage");
    const fetchMock = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as any),
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      await expect(podcastAdapter.fetch({
        params: { feeds: ["https://example.com/podcast.xml"] },
      } as any)).rejects.toThrow(/podcast: failed to fetch .*404/);
      const delta = errorMessageSpy.mock.calls.length; // >=1 (status in error ctor; may be more from matcher)
      expect(delta).toBeGreaterThanOrEqual(1);
      expect(errorMessageSpy).toHaveBeenCalledWith({ message: "404" });
    } finally {
      globalThis.fetch = origFetch;
      errorMessageSpy.mockRestore();
      mock.restore();
    }
  });
});
