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
      const items = await podcastAdapter.fetch({
        params: { feeds: ["https://example.com/podcast.xml"] },
      } as any);

      expect(items).toEqual([]);
      const delta = errorMessageSpy.mock.calls.length; // will be 0 pre-edit, 1 post
      expect(delta).toBe(1);
      expect(errorMessageSpy).toHaveBeenCalledWith({ message: "404" });
    } finally {
      globalThis.fetch = origFetch;
      errorMessageSpy.mockRestore();
      mock.restore();
    }
  });
});
