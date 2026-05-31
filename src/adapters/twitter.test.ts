import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import adapter from "./twitter";
import * as typesMod from "./types";

describe("adapters/twitter", () => {
  it("satisfies ngb contract (default export .name + .fetch fn, discoverable via index)", () => {
    expect(adapter).toHaveProperty("name", "twitter");
    expect(typeof adapter.fetch).toBe("function");
  });

  it("uses errorMessage in its log paths (mmu/sh1 quality; returns [] for valid no-sources/config cases per contract)", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    const configWithLists = { type: "twitter", params: { lists: ["foo"] } } as any;
    const res1 = await adapter.fetch(configWithLists);
    expect(res1).toEqual([]);
    expect(emSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "twitter: adapter configured with 1 source(s), but Twitter API requires API credentials. Set params.bearer_token to enable. Returning empty results."
        ),
      })
    );

    emSpy.mockClear();
    const configNoSources = { type: "twitter" } as any;
    const res2 = await adapter.fetch(configNoSources);
    expect(res2).toEqual([]);
    expect(emSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "twitter: no lists or searches configured, and Twitter API requires credentials. Returning empty results."
        ),
      })
    );
  });
});
