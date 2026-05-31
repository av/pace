import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import mastodonAdapter from "./mastodon";
import { errorMessage } from "./types";

describe("adapters/mastodon (TDD coverage for untested adapter + ngb/mmu error contract quality)", () => {
  let warnSpy: ReturnType<typeof spyOn>;
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn");
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  test("exports default with .name 'mastodon' and callable .fetch (ngb contract, discovery shape)", () => {
    expect(mastodonAdapter).toBeDefined();
    expect(mastodonAdapter.name).toBe("mastodon");
    expect(typeof mastodonAdapter.fetch).toBe("function");
  });

  test("fetch on network error: returns [], warns with 'mastodon: ' prefix using errorMessage(err) in string (mmu/sh1 quality; robust vs raw err)", async () => {
    const testErr = new Error("network boom for mastodon test");
    fetchSpy.mockRejectedValueOnce(testErr);

    const items = await mastodonAdapter.fetch({ params: { instance: "example.invalid" } });

    expect(items).toEqual([]);

    const errorCalls = warnSpy.mock.calls.filter((call: any[]) =>
      String(call[0]).includes("mastodon: error fetching from example.invalid")
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);

    const warnMsg = String(errorCalls[0][0]);
    // After quality edit: uses ${errorMessage(err)} so msg includes the error text (not just raw object in 2nd arg)
    expect(warnMsg).toContain(errorMessage(testErr));
    expect(warnMsg).toContain("network boom for mastodon test");
  });
});
