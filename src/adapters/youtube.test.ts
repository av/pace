import { describe, it, expect, spyOn, afterEach, beforeEach } from "bun:test";
import youtubeAdapter from "./youtube";

describe("youtube adapter", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("satisfies ngb contract (default export .name string + .fetch function)", () => {
    expect(youtubeAdapter.name).toBe("youtube");
    expect(typeof youtubeAdapter.fetch).toBe("function");
  });

  it("uses errorMessage(err) in console.warn on network error per mmu (warn+[] path, robust msg per sh1)", async () => {
    const testErr = new Error("network boom for youtube test");
    const origFetch = globalThis.fetch;
    // @ts-expect-error mock
    globalThis.fetch = async () => { throw testErr; };

    try {
      await youtubeAdapter.fetch({
        type: "youtube",
        params: { channels: ["UCtestchannel"] },
      });
      expect(warnSpy).toHaveBeenCalled();
      const calls = warnSpy.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // pre-edit: warn(prefix, err) so [0] is prefix string only; post-edit: single arg full interpolated
      const firstArg = calls[0][0];
      const warnMsg = typeof firstArg === "string" ? firstArg : String(firstArg ?? calls[0]);
      expect(warnMsg).toContain("network boom for youtube test");
      expect(warnMsg).toContain("youtube: error fetching");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
